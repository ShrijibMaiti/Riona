/**
 * Support tickets, as staff see them: the whole thread including internal notes, and the assignee. The client
 * raises and replies through the portal (modules/portal); both read and write these same tables.
 * Anyone with access to clients reads tickets; replying or changing the status takes clients:edit or being the
 * ticket's assignee.
 */
import type { Ticket } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, can } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/dates';

type Q = Kysely<DB> | Transaction<DB>;

export const TicketReply = z.object({ text: z.string({ required_error: 'Write a reply first.' }).max(10000), internal: z.boolean().default(false) });
export const TicketStatus = z.object({ status: z.enum(['Open', 'In progress', 'Waiting on client', 'Resolved'], { errorMap: () => ({ message: 'Choose a status.' }) }) });

export async function loadTickets(q: Q, where: { ids?: string[]; clientId?: string } = {}): Promise<Ticket[]> {
  let tq = q.selectFrom('tickets').selectAll();
  if (where.ids) {
    if (!where.ids.length) return [];
    tq = tq.where('id', 'in', where.ids);
  }
  if (where.clientId) tq = tq.where('clientId', '=', where.clientId);
  const rows = await tq.orderBy('opened', 'desc').orderBy('id', 'desc').execute();
  if (!rows.length) return [];
  const msgs = await q.selectFrom('ticketMessages').selectAll().where('ticketId', 'in', rows.map((r) => r.id)).orderBy('seq').execute();
  return rows.map((t) => ({
    id: t.id, clientId: t.clientId, projectId: t.projectId, subject: t.subject, priority: t.priority as Ticket['priority'], assigneeId: t.assigneeId,
    status: t.status as Ticket['status'], opened: t.opened, resolved: t.resolved, slaDue: t.slaDue,
    messages: msgs.filter((m) => m.ticketId === t.id).map((m) => ({ id: m.id, at: m.at, author: m.author, authorId: m.authorId, internal: m.internal, text: m.text })),
  }));
}

/** GET /tickets?clientId */
export async function listTickets(actor: Actor, clientId?: string): Promise<Ticket[]> {
  authorize(actor, 'clients', 'view');
  return loadTickets(db, { clientId: clientId || undefined });
}

/** GET /tickets/:id */
export async function getTicket(actor: Actor, id: string): Promise<Ticket> {
  authorize(actor, 'clients', 'view');
  const [t] = await loadTickets(db, { ids: [id] });
  if (!t) throw notFound('Ticket not found');
  return t;
}

async function lockForWork(tx: { db: Transaction<DB> }, actor: Actor, id: string) {
  authorize(actor, 'clients', 'view');
  const row = await tx.db.selectFrom('tickets').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!row) throw notFound('Ticket not found');
  if (!can(actor, 'clients', 'edit') && row.assigneeId !== actor.employeeId) throw forbidden('Only the assignee or an account manager can work on this ticket.');
  return row;
}

/** POST /tickets/:id/messages { text, internal } — a public reply is emailed to the client's portal users. */
export async function replyToTicket(actor: Actor, id: string, text: string, internal: boolean): Promise<Ticket> {
  if (!text.trim()) throw unprocessable('Write a reply first.', { text: 'Required' });
  return withTransaction(actor, async (tx) => {
    const row = await lockForWork(tx, actor, id);
    await tx.db.insertInto('ticketMessages').values({ id: newId('TM'), ticketId: id, at: nowIso(), author: actor.name, authorId: actor.employeeId, internal, text: text.trim() }).execute();
    await tx.audit('Updated', 'Ticket', id, [{ field: internal ? 'internal note' : 'reply', before: null, after: text.trim().slice(0, 200) }]);
    if (!internal) {
      const contacts = await tx.db.selectFrom('users').select('email').where('clientId', '=', row.clientId).where('status', '=', 'Active').execute();
      for (const c of contacts) await tx.email({ to: c.email, subject: `Re: ${row.subject} [${id}]`, text: `${actor.name} replied:\n\n${text.trim()}\n\nReply in your client portal.` });
    }
    return (await loadTickets(tx.db, { ids: [id] }))[0];
  });
}

/** PATCH /tickets/:id { status } */
export async function setTicketStatus(actor: Actor, id: string, status: Ticket['status']): Promise<Ticket> {
  return withTransaction(actor, async (tx) => {
    const row = await lockForWork(tx, actor, id);
    if (row.status === status) return (await loadTickets(tx.db, { ids: [id] }))[0];
    await tx.db.updateTable('tickets').set({ status, resolved: status === 'Resolved' ? nowIso() : null }).where('id', '=', id).execute();
    await tx.audit('Updated', 'Ticket', id, [{ field: 'status', before: row.status, after: status }]);
    return (await loadTickets(tx.db, { ids: [id] }))[0];
  });
}
