/**
 * The client portal. Every read goes through withClientScope (read-only, as riona_portal, scoped to the signed-in
 * client), so it can only see what migration 011 lets a client see. Writes (raising and replying to tickets,
 * starting a payment) run as the application, after a scoped read has shown the record is the client's own.
 */
import type { PortalDocument, PortalInvoice, PortalProject, PortalSession, PortalTicket, TicketPriority } from '@riona/shared';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { clientOf, withClientScope } from '../../http/plugins/portal-scope';
import type { Actor } from '../../http/plugins/session';
import { conflict, notFound, unavailable, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/dates';
import { toPaise } from '../../lib/money';
import { config } from '../../config';
import { settleIntent } from './payments';
import { fileRecord, signedUrl } from '../../storage/files';
import { toPortalDocument, toPortalInvoice, toPortalProject, toPortalTicket } from './projections';

type Q = Transaction<DB>;

export const RaiseTicket = z.object({
  subject: z.string({ required_error: 'Add a subject.' }).max(200, 'Keep the subject under 200 characters.'),
  text: z.string({ required_error: 'Describe what’s happening.' }).max(10000),
  priority: z.enum(['Urgent', 'High', 'Medium', 'Low'], { errorMap: () => ({ message: 'Choose a priority.' }) }),
  projectId: z.string().max(40).nullable().default(null),
});
export const ReplyTicket = z.object({ text: z.string({ required_error: 'Write a reply first.' }).max(10000) });
export const PayInvoice = z.object({ method: z.enum(['UPI', 'NEFT'], { errorMap: () => ({ message: 'Choose UPI or bank transfer.' }) }) });

/** Resolution time by priority, in hours (the default support SLA). */
const SLA_HOURS: Record<TicketPriority, number> = { Urgent: 4, High: 8, Medium: 24, Low: 72 };

const vendorOf = async (q: Q) => {
  const name = (await q.selectFrom('org').select('name').executeTakeFirst())?.name ?? 'Riona';
  return { name, short: name.split(' ')[0] };
};

// ---------------- session ----------------

/** GET /portal/session — who is signed in, for which client, with which vendor. */
export async function getPortalSession(actor: Actor): Promise<PortalSession> {
  const clientId = clientOf(actor);
  const email = (await db.selectFrom('users').select('email').where('id', '=', actor.userId).executeTakeFirstOrThrow()).email;
  return withClientScope(clientId, async (q) => {
    const c = await q.selectFrom('clients').select(['id', 'name']).executeTakeFirstOrThrow();
    return { clientId: c.id, clientName: c.name, contactName: actor.name, contactEmail: email, vendorName: (await vendorOf(q)).name };
  });
}

// ---------------- projects ----------------

async function projects(q: Q, id?: string): Promise<PortalProject[]> {
  let pq = q.selectFrom('projects').select(['id', 'name', 'start', 'end', 'status', 'phases', 'milestones']);
  if (id) pq = pq.where('id', '=', id);
  const rows = await pq.orderBy('start').orderBy('id').execute();
  if (!rows.length) return [];
  const tasks = await q.selectFrom('tasks').select(['projectId', 'status']).where('projectId', 'in', rows.map((r) => r.id)).execute();
  return rows.map((p) => toPortalProject(p, tasks.filter((t) => t.projectId === p.id)));
}

/** GET /portal/projects */
export const getPortalProjects = (actor: Actor) => withClientScope(clientOf(actor), (q) => projects(q));

/** GET /portal/projects/:id */
export async function getPortalProject(actor: Actor, id: string): Promise<PortalProject> {
  const [p] = await withClientScope(clientOf(actor), (q) => projects(q, id));
  if (!p) throw notFound('Project not found');
  return p;
}

// ---------------- invoices ----------------

async function invoices(q: Q, id?: string): Promise<PortalInvoice[]> {
  // The policy already limits this to the client's issued invoices; the where clause is for the single read.
  let iq = q.selectFrom('invoices').select(['id', 'number', 'issued', 'due', 'status', 'issuedTotals']);
  if (id) iq = iq.where('id', '=', id);
  const rows = await iq.orderBy('issued', 'desc').orderBy('id', 'desc').execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [lines, payments, revisions] = await Promise.all([
    q.selectFrom('invoiceLines').select(['id', 'invoiceId', 'description', 'quantity', 'unit', 'ratePaise', 'amountPaise']).where('invoiceId', 'in', ids).orderBy('position').execute(),
    q.selectFrom('payments').select(['invoiceId', 'date', 'amountPaise', 'method', 'reference']).where('invoiceId', 'in', ids).orderBy('date').orderBy('id').execute(),
    q.selectFrom('invoiceRevisions').select(['invoiceId', 'at', 'reason', 'totalPaise']).where('invoiceId', 'in', ids).orderBy('id').execute(),
  ]);
  return rows.map((r) => toPortalInvoice(r, lines.filter((l) => l.invoiceId === r.id), payments.filter((p) => p.invoiceId === r.id), revisions.filter((v) => v.invoiceId === r.id)));
}

/** GET /portal/invoices — issued invoices only, newest first. */
export const getPortalInvoices = (actor: Actor) => withClientScope(clientOf(actor), (q) => invoices(q));

/** GET /portal/invoices/:id */
export async function getPortalInvoice(actor: Actor, id: string): Promise<PortalInvoice> {
  const [inv] = await withClientScope(clientOf(actor), (q) => invoices(q, id));
  if (!inv) throw notFound('Invoice not found');
  return inv;
}

/**
 * POST /portal/invoices/:id/pay { method } — pays the balance online. A payment intent is created for the
 * balance; the gateway confirms it (signed webhook, or at once with the simulated gateway) and only then is the
 * payment recorded against the invoice, as Finance sees it.
 */
export async function payPortalInvoice(actor: Actor, id: string, method: 'UPI' | 'NEFT'): Promise<PortalInvoice> {
  const clientId = clientOf(actor);
  if (config.payments.gateway === 'none') throw unavailable('Online payment isn’t available yet. Pay by bank transfer using the details on the invoice.');
  const inv = await getPortalInvoice(actor, id);
  if (inv.balance <= 0) throw conflict('This invoice is already paid.', 'invoice.paid');
  const intentId = await withTransaction(actor, async (tx) => {
    // One payment at a time per invoice: a second click waits for the first and then sees it.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'riona.pay.' + id}))`.execute(tx.db);
    const open = await tx.db.selectFrom('paymentIntents').select('id').where('invoiceId', '=', id).where('status', '=', 'Created').executeTakeFirst();
    if (open && config.payments.gateway === 'webhook') throw conflict('A payment for this invoice is already in progress.', 'invoice.payment_pending');
    const iid = newId('PI');
    await tx.db.insertInto('paymentIntents').values({ id: iid, invoiceId: id, clientId, amountPaise: toPaise(inv.balance), method }).execute();
    await tx.audit('Created', 'Payment', iid, [{ field: 'invoice', before: null, after: id }, { field: 'amount', before: null, after: String(inv.balance) }]);
    return iid;
  });
  if (config.payments.gateway === 'simulated') {
    await settleIntent(intentId, { status: 'captured', reference: 'PG-' + id.replace(/\D/g, '') + '-' + intentId.slice(-5).toUpperCase() });
  }
  return getPortalInvoice(actor, id);
}

// ---------------- tickets ----------------

async function tickets(q: Q, id?: string): Promise<PortalTicket[]> {
  let tq = q.selectFrom('tickets').select(['id', 'clientId', 'projectId', 'subject', 'priority', 'status', 'opened', 'resolved', 'slaDue']);
  if (id) tq = tq.where('id', '=', id);
  const rows = await tq.orderBy('opened', 'desc').orderBy('id', 'desc').execute();
  if (!rows.length) return [];
  // Internal notes are excluded by the policy, not by this query.
  const msgs = await q.selectFrom('ticketMessages').select(['id', 'ticketId', 'at', 'author', 'fromClient', 'text']).where('ticketId', 'in', rows.map((r) => r.id)).orderBy('seq').execute();
  const vendor = (await vendorOf(q)).short;
  return rows.map((t) => toPortalTicket(t, msgs.filter((m) => m.ticketId === t.id).map((m) => ({ ...m, fromClient: !!m.fromClient })), vendor));
}

/** GET /portal/tickets */
export const getPortalTickets = (actor: Actor) => withClientScope(clientOf(actor), (q) => tickets(q));

/** GET /portal/tickets/:id */
export async function getPortalTicket(actor: Actor, id: string): Promise<PortalTicket> {
  const [t] = await withClientScope(clientOf(actor), (q) => tickets(q, id));
  if (!t) throw notFound('Ticket not found');
  return t;
}

/** POST /portal/tickets — goes to the project's manager, or the client's account owner. */
export async function raisePortalTicket(actor: Actor, input: z.infer<typeof RaiseTicket>): Promise<PortalTicket> {
  const clientId = clientOf(actor);
  if (!input.subject.trim()) throw unprocessable('Add a subject.', { subject: 'Required' });
  if (!input.text.trim()) throw unprocessable('Describe what’s happening.', { text: 'Required' });
  if (input.projectId && !(await withClientScope(clientId, (q) => projects(q, input.projectId!))).length) {
    throw unprocessable('Choose one of your projects.', { projectId: 'Unknown' });
  }
  const id = await withTransaction(actor, async (tx) => {
    const owner = input.projectId
      ? (await tx.db.selectFrom('projects').select('managerId').where('id', '=', input.projectId).executeTakeFirst())?.managerId
      : null;
    const client = await tx.db.selectFrom('clients').select('ownerId').where('id', '=', clientId).executeTakeFirstOrThrow();
    // Nobody named on the project or account: an Admin picks it up.
    const admin = async () => (await tx.db.selectFrom('users').select('employeeId').where('role', '=', 'Admin').where('status', '=', 'Active').where('employeeId', 'is not', null).orderBy('employeeId').executeTakeFirstOrThrow()).employeeId!;
    const assigneeId: string = owner ?? client.ownerId ?? (await admin());
    await sql`SELECT pg_advisory_xact_lock(hashtext('riona.ticket-ids'))`.execute(tx.db);
    const last = await tx.db.selectFrom('tickets').select(sql<number>`max(substring(id from 4)::int)`.as('n')).where('id', '~', '^TK-\\d+$').executeTakeFirst();
    const tid = 'TK-' + ((last?.n ?? 1000) + 1);
    const opened = nowIso();
    await tx.db.insertInto('tickets').values({
      id: tid, clientId, projectId: input.projectId, subject: input.subject.trim(), priority: input.priority, assigneeId, status: 'Open', opened,
      slaDue: new Date(Date.parse(opened) + SLA_HOURS[input.priority] * 36e5).toISOString(),
    }).execute();
    await tx.db.insertInto('ticketMessages').values({ id: newId('TM'), ticketId: tid, at: opened, author: actor.name, authorId: null, internal: false, text: input.text.trim() }).execute();
    await tx.audit('Created', 'Ticket', tid, [{ field: 'subject', before: null, after: input.subject.trim() }, { field: 'priority', before: null, after: input.priority }]);
    await tx.notify({ recipientIds: [assigneeId], kind: 'System', text: `${actor.name} raised ${tid}: ${input.subject.trim()}`, href: '/app/clients/tickets/' + tid });
    return tid;
  });
  return getPortalTicket(actor, id);
}

/** POST /portal/tickets/:id/messages { text } — a reply moves a ticket waiting on the client back to in progress. */
export async function replyPortalTicket(actor: Actor, id: string, text: string): Promise<PortalTicket> {
  const ticket = await getPortalTicket(actor, id); // 404 unless it is this client's
  if (!text.trim()) throw unprocessable('Write a reply first.', { text: 'Required' });
  await withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('tickets').select(['status', 'assigneeId']).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
    await tx.db.insertInto('ticketMessages').values({ id: newId('TM'), ticketId: id, at: nowIso(), author: actor.name, authorId: null, internal: false, text: text.trim() }).execute();
    if (row.status === 'Waiting on client') {
      await tx.db.updateTable('tickets').set({ status: 'In progress' }).where('id', '=', id).execute();
      await tx.audit('Updated', 'Ticket', id, [{ field: 'status', before: row.status, after: 'In progress' }]);
    }
    await tx.notify({ recipientIds: [row.assigneeId], kind: 'System', text: `${actor.name} replied on ${id}: ${ticket.subject}`, href: '/app/clients/tickets/' + id });
  });
  return getPortalTicket(actor, id);
}

// ---------------- documents ----------------

async function documents(q: Q, id?: string): Promise<(PortalDocument & { fileId: string | null })[]> {
  // Shared documents of the client and its projects: the policy decides which; this only reads them.
  let dq = q.selectFrom('documents').select(['id', 'name', 'type', 'ownerType', 'ownerId']);
  if (id) dq = dq.where('id', '=', id);
  const rows = await dq.orderBy(sql`length(id)`).orderBy('id').execute();
  if (!rows.length) return [];
  const [versions, projectNames] = await Promise.all([
    q.selectFrom('documentVersions').select(['documentId', 'version', 'uploaded', 'size', 'fileId']).where('documentId', 'in', rows.map((r) => r.id)).orderBy('version').execute(),
    q.selectFrom('projects').select(['id', 'name']).execute(),
  ]);
  const name = new Map(projectNames.map((p) => [p.id, p.name]));
  return rows.flatMap((d) => {
    const latest = versions.filter((v) => v.documentId === d.id).at(-1);
    return latest ? [{ ...toPortalDocument(d, latest, name.get(d.ownerId) ?? null), fileId: latest.fileId }] : [];
  });
}

/** GET /portal/documents — only documents shared with the client. */
export const getPortalDocuments = async (actor: Actor): Promise<PortalDocument[]> =>
  (await withClientScope(clientOf(actor), (q) => documents(q))).map(({ fileId: _f, ...d }) => d);

/**
 * GET /portal/documents/:id/download — the latest shared version as a five-minute signed link. Versions from
 * before uploads existed (the demo data) have no file: those download a text stand-in, as in the demo.
 */
export async function getPortalDocumentUrl(actor: Actor, id: string): Promise<{ url: string; filename: string }> {
  const [doc] = await withClientScope(clientOf(actor), (q) => documents(q, id));
  if (!doc) throw notFound('Document not found');
  // The scoped read above proved the client may have it; the link itself is signed and short-lived.
  if (doc.fileId) {
    const file = await fileRecord(db, doc.fileId);
    if (file) {
      const filename = doc.name.replace(/[^A-Za-z0-9]+/g, '-') + '-v' + doc.version + (file.filename.includes('.') ? '.' + file.filename.split('.').pop() : '');
      return { url: signedUrl(file.id, filename), filename };
    }
  }
  const body = `${doc.name}\nVersion ${doc.version}\nShared ${doc.uploaded}\n`;
  return { url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(body), filename: doc.name.replace(/[^A-Za-z0-9]+/g, '-') + '-v' + doc.version + '.txt' };
}
