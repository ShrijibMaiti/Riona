/**
 * Invoices. The server builds every line from the ids the client sends: approved billable hours (one time line
 * per project and person, at the person's bill rate) and approved billable claims, plus any manual lines. A line
 * can therefore never disagree with what it bills, and an hour can be billed only once (enforced again by the
 * database, 012). Sending goes through the "Invoice" approval workflow; when it is approved the invoice is issued
 * and its totals are frozen.
 */
import type { Invoice, InvoiceLine, Paginated } from '@riona/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction, type Tx } from '../../db/tx';
import { authorize, can } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { openApproval } from '../../engines/approvals/engine';
import type { OutcomeHandler } from '../../engines/approvals/outcomes';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { addDays, today } from '../../lib/dates';
import { toPaise, toRupees } from '../../lib/money';
import { F, opt } from '../../lib/validate';
import { freeze, invoiceTotals } from './gst';
import { frozenOf, homeState, loadInvoices } from './invoices.repo';

export const InvoiceFilter = z.object({
  search: opt(z.string().max(200)), clientId: opt(z.string().max(40)), status: opt(z.string().max(20)), ageing: opt(z.string().max(20)),
  page: opt(F.page), pageSize: opt(F.pageSize),
});

/** POST /invoices */
export const NewInvoice = z.object({
  clientId: z.string().min(1, 'Choose a client.').max(40),
  issued: F.date,
  termsDays: z.number().int().min(0).max(120),
  notes: F.text(2000).default(''),
  discount: z.number().min(0, 'The discount can’t be negative.').default(0),
  entryIds: z.array(z.string().max(40)).max(5000).default([]),
  expenseIds: z.array(z.string().max(40)).max(500).default([]),
  manual: z.array(z.object({ description: F.text(300), amount: z.number() })).max(50).default([]),
});

/** POST /invoices/:id/payments { date, amount, method, reference, totalDue } — totalDue (the screen's figure) is ignored. */
export const PaymentInput = z.object({
  date: F.date,
  amount: z.number({ required_error: 'Enter an amount.', invalid_type_error: 'Enter an amount.' }).positive('Enter an amount above zero.'),
  method: z.enum(['NEFT', 'RTGS', 'Cheque', 'UPI'], { errorMap: () => ({ message: 'Choose how it was paid.' }) }),
  reference: F.text(120).default(''),
});

export async function listInvoices(actor: Actor, f: z.infer<typeof InvoiceFilter>): Promise<Paginated<Invoice>> {
  const page = f.page ?? 1, pageSize = f.pageSize ?? 1000;
  if (!can(actor, 'finance', 'view')) return { items: [], total: 0, page, pageSize };
  const all = await loadInvoices(db, { clientId: f.clientId, status: f.status, search: f.search });
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

export async function getInvoice(actor: Actor, id: string): Promise<Invoice> {
  authorize(actor, 'finance', 'view');
  const [inv] = await loadInvoices(db, { ids: [id] });
  if (!inv) throw notFound('Invoice not found');
  return inv;
}

/** Postgres refused a second live link to an entry or claim: someone billed it in the meantime. */
const isDoubleBill = (e: unknown) => (e as { code?: string; constraint?: string }).code === '23505' && /invoice_line_(entries|expenses)_once/.test((e as { constraint?: string }).constraint ?? '');

/** The next invoice number for a year, INV-2026-0128, taken under a lock so two can't collide. */
async function nextNumber(tx: Tx, year: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtext('riona.invoice-numbers'))`.execute(tx.db);
  const last = await tx.db.selectFrom('invoices').select(sql<number>`max(substring(number from '(\\d+)$')::int)`.as('n')).where('number', 'like', `INV-${year}-%`).executeTakeFirst();
  return `INV-${year}-${String((last?.n ?? 0) + 1).padStart(4, '0')}`;
}

export async function createInvoice(actor: Actor, input: z.infer<typeof NewInvoice>): Promise<Invoice> {
  authorize(actor, 'finance', 'edit');
  try {
    return await withTransaction(actor, async (tx) => {
      const client = await tx.db.selectFrom('clients').select(['id', 'state']).where('id', '=', input.clientId).executeTakeFirst();
      if (!client) throw unprocessable('Choose a client.', { clientId: 'Unknown' });
      const entryIds = [...new Set(input.entryIds)], expenseIds = [...new Set(input.expenseIds)];

      const entries = entryIds.length ? await tx.db.selectFrom('timesheetEntries').selectAll().where('id', 'in', entryIds).orderBy('date').orderBy('id').forUpdate().execute() : [];
      if (entries.length !== entryIds.length) throw unprocessable('Some of these hours no longer exist. Refresh and try again.');
      const billed = entryIds.length ? await tx.db.selectFrom('invoiceLineEntries').select('entryId').where('entryId', 'in', entryIds).where('live', '=', true).execute() : [];
      if (billed.length) throw conflict('Some of these hours were invoiced in the meantime. Refresh and try again.', 'invoice.already_billed');
      if (entries.some((e) => e.clientId !== input.clientId || e.status !== 'Approved' || !e.billable)) throw unprocessable('Only approved billable hours for this client can be invoiced.');

      const claims = expenseIds.length ? await tx.db.selectFrom('expenses').selectAll().where('id', 'in', expenseIds).forUpdate().execute() : [];
      if (claims.length !== expenseIds.length) throw unprocessable('Some of these claims no longer exist. Refresh and try again.');
      if (claims.some((x) => x.clientId !== input.clientId || !x.billable || (x.status !== 'Approved' && x.status !== 'Reimbursed'))) throw unprocessable('Only approved billable claims for this client can be invoiced.');
      const claimBilled = expenseIds.length ? await tx.db.selectFrom('invoiceLineExpenses').select('expenseId').where('expenseId', 'in', expenseIds).where('live', '=', true).execute() : [];
      if (claimBilled.length) throw conflict('Some of these claims were invoiced in the meantime. Refresh and try again.', 'invoice.already_billed');

      // One time line per project and person, at the person's bill rate.
      const people = new Map((await tx.db.selectFrom('employees').select(['id', 'name', 'billRatePaise']).where('id', 'in', entries.length ? [...new Set(entries.map((e) => e.employeeId))] : ['-']).execute()).map((e) => [e.id, e]));
      const projects = new Map((await tx.db.selectFrom('projects').select(['id', 'name']).where('clientId', '=', input.clientId).execute()).map((p) => [p.id, p]));
      const groups = new Map<string, typeof entries>();
      for (const e of entries) groups.set(e.projectId + '|' + e.employeeId, [...(groups.get(e.projectId + '|' + e.employeeId) ?? []), e]);

      const number = await nextNumber(tx, input.issued.slice(0, 4));
      const id = number;
      const lines: (InvoiceLine & { links: string[]; claimLinks: string[] })[] = [];
      let n = 1;
      for (const [k, list] of groups) {
        const [pid, eid] = k.split('|');
        const qty = Math.round(list.reduce((a, e) => a + e.hours, 0) * 100) / 100;
        const rate = toRupees(people.get(eid)!.billRatePaise);
        lines.push({ id: `${id}-L${n++}`, kind: 'time', projectId: pid, description: `${projects.get(pid)?.name ?? pid} · ${people.get(eid)!.name}`, entryIds: list.map((e) => e.id), expenseIds: [], quantity: qty, unit: 'h', rate, amount: Math.round(qty * rate), links: list.map((e) => e.id), claimLinks: [] });
      }
      for (const x of claims) {
        const amount = toRupees(x.amountPaise);
        lines.push({ id: `${id}-L${n++}`, kind: 'expense', projectId: x.projectId, description: 'Billable expense · ' + x.description, entryIds: [], expenseIds: [x.id], quantity: 1, unit: 'item', rate: amount, amount, links: [], claimLinks: [x.id] });
      }
      for (const m of input.manual.filter((m) => m.description && m.amount > 0)) {
        lines.push({ id: `${id}-L${n++}`, kind: 'manual', projectId: null, description: m.description, entryIds: [], expenseIds: [], quantity: 1, unit: 'item', rate: m.amount, amount: Math.round(m.amount), links: [], claimLinks: [] });
      }
      if (!lines.length) throw unprocessable('Add at least one line.');
      const totals = invoiceTotals(lines, input.discount, [], client.state, await homeState(tx.db));
      if (input.discount > totals.subtotal) throw unprocessable('The discount must be between zero and the subtotal.', { discount: 'Too large' });

      await tx.db.insertInto('invoices').values({ id, number, clientId: input.clientId, issued: input.issued, due: addDays(input.issued, input.termsDays), status: 'Draft', discountPaise: toPaise(input.discount), notes: input.notes }).execute();
      await writeLines(tx, id, lines);
      await tx.audit('Created', 'Invoice', id, [{ field: 'status', before: null, after: 'Draft' }, { field: 'subtotal', before: null, after: String(totals.subtotal) }]);
      return (await loadInvoices(tx.db, { ids: [id] }))[0];
    });
  } catch (e) {
    if (isDoubleBill(e)) throw conflict('Some of these hours were invoiced in the meantime. Refresh and try again.', 'invoice.already_billed');
    throw e;
  }
}

/** Inserts lines with their links to the hours and claims they bill (position = order given). */
export async function writeLines(tx: Tx, invoiceId: string, lines: (Omit<InvoiceLine, 'entryIds' | 'expenseIds'> & { links: string[]; claimLinks: string[] })[]) {
  for (const [i, l] of lines.entries()) {
    await tx.db.insertInto('invoiceLines').values({ id: l.id, invoiceId, position: i + 1, kind: l.kind, projectId: l.projectId, description: l.description, quantity: l.quantity, unit: l.unit, ratePaise: toPaise(l.rate), amountPaise: toPaise(l.amount) }).execute();
    if (l.links.length) await tx.db.insertInto('invoiceLineEntries').values(l.links.map((entryId) => ({ lineId: l.id, entryId, invoiceId }))).execute();
    if (l.claimLinks.length) await tx.db.insertInto('invoiceLineExpenses').values(l.claimLinks.map((expenseId) => ({ lineId: l.id, expenseId, invoiceId }))).execute();
  }
}

/** Issues a draft: freezes its totals and marks it sent. In the deciding transaction. */
async function issue(tx: Tx, id: string) {
  const inv = (await loadInvoices(tx.db, { ids: [id] }))[0];
  if (!inv || inv.status !== 'Draft') return;
  const client = await tx.db.selectFrom('clients').select('state').where('id', '=', inv.clientId).executeTakeFirstOrThrow();
  const totals = invoiceTotals(inv.lines, inv.discount, [], client.state, await homeState(tx.db));
  await tx.db.updateTable('invoices').set({ status: 'Sent', issuedTotals: JSON.stringify(freeze(totals)) }).where('id', '=', id).execute();
  await tx.audit('Issued', 'Invoice', id, [{ field: 'status', before: 'Draft', after: 'Sent' }, { field: 'total', before: null, after: String(totals.total) }]);
}

/**
 * POST /invoices/:id/send — through the "Invoice" sign-off workflow. Under the workflow's threshold nobody needs to
 * sign it off, so it is issued at once; above it, it is issued when the approver approves.
 */
export async function sendInvoice(actor: Actor, id: string): Promise<Invoice> {
  authorize(actor, 'finance', 'edit');
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('invoices').select(['id', 'status', 'clientId', 'approvalId']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw notFound('Invoice not found');
    if (row.status !== 'Draft') throw conflict('Only a draft can be sent.');
    if (row.approvalId && (await tx.db.selectFrom('approvals').select('id').where('id', '=', row.approvalId).where('status', '=', 'Pending').executeTakeFirst())) {
      throw conflict('This invoice is already waiting for sign-off.');
    }
    const inv = (await loadInvoices(tx.db, { ids: [id] }))[0];
    const client = await tx.db.selectFrom('clients').select(['state', 'ownerId']).where('id', '=', row.clientId).executeTakeFirstOrThrow();
    const totals = invoiceTotals(inv.lines, inv.discount, [], client.state, await homeState(tx.db));
    const ap = await openApproval(tx, {
      type: 'Invoice', sourceId: id, requesterId: actor.employeeId!, facts: { total: totals.total }, accountOwnerId: client.ownerId, autoApproveWhenNoApprover: true,
    });
    await tx.db.updateTable('invoices').set({ approvalId: ap.id }).where('id', '=', id).execute();
    await tx.audit('Sent', 'Invoice', id, [{ field: 'sign-off', before: null, after: ap.status === 'Pending' ? 'Waiting for sign-off' : 'Not needed' }]);
    return (await loadInvoices(tx.db, { ids: [id] }))[0];
  });
}

/** POST /invoices/:id/payments — against the frozen total; the balance is worked out here, never taken from the client. */
export async function recordPayment(actor: Actor, id: string, input: z.infer<typeof PaymentInput>): Promise<Invoice> {
  authorize(actor, 'finance', 'edit');
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('invoices').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw notFound('Invoice not found');
    if (!['Sent', 'Overdue', 'Partially paid'].includes(row.status)) throw conflict('Only an issued invoice with a balance can take a payment.');
    const total = frozenOf(row)!.total;
    const paid = Number((await tx.db.selectFrom('payments').select(sql<number>`coalesce(sum(amount_paise), 0)`.as('s')).where('invoiceId', '=', id).executeTakeFirstOrThrow()).s);
    const amount = toPaise(input.amount);
    if (amount > total - paid + 100) throw unprocessable(`That’s more than the balance due (₹${toRupees(total - paid).toLocaleString('en-IN')}).`, { amount: 'Too much' });
    await tx.db.insertInto('payments').values({ id: newId('PAY'), invoiceId: id, date: input.date, amountPaise: amount, method: input.method, reference: input.reference, actorId: actor.employeeId }).execute();
    const status = paid + amount >= total - 100 ? 'Paid' : 'Partially paid';
    await tx.db.updateTable('invoices').set({ status }).where('id', '=', id).execute();
    await tx.audit('Updated', 'Invoice', id, [{ field: 'status', before: row.status, after: status }, { field: 'payment', before: null, after: String(input.amount) }]);
    return (await loadInvoices(tx.db, { ids: [id] }))[0];
  });
}

/** The approval engine's side of invoices: the queue embeds the invoice; approval issues it. */
export const invoiceOutcome: OutcomeHandler = {
  loadSources: async (q, ids) => new Map((await loadInvoices(q, { ids })).map((inv) => [inv.id, { kind: 'Invoice' as const, invoice: inv }])),
  apply: async (tx, a) => {
    if (a.status === 'Approved') await issue(tx, a.sourceId);
  },
};

/** Hourly: issued invoices past their due date become Overdue. Returns how many changed. */
export async function markOverdue() {
  const r = await db.updateTable('invoices').set({ status: 'Overdue' }).where('status', 'in', ['Sent', 'Partially paid']).where('due', '<', today()).executeTakeFirst();
  return Number(r.numUpdatedRows);
}
