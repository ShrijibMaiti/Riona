/**
 * Expense claims. Scoped like other personal records: one's own, a manager's team's, everyone's for HR and Admin.
 * Submitting opens an "Expense" approval (the workflow may refuse a claim outright, e.g. over a threshold).
 * Reopening an approved claim keeps what was approved before: the first revision is the claim as first approved.
 */
import type { ExpenseClaim, Paginated } from '@riona/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, can, selfId } from '../../auth/rbac/authorize';
import { visibleEmployeeIds } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { openApproval } from '../../engines/approvals/engine';
import type { OutcomeHandler } from '../../engines/approvals/outcomes';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { nowIso, today } from '../../lib/dates';
import { toPaise, toRupees } from '../../lib/money';
import { F, opt } from '../../lib/validate';

type Q = Kysely<DB> | Transaction<DB>;
const CATEGORIES = ['Travel', 'Meals', 'Software', 'Hardware', 'Training', 'Client entertainment', 'Office'] as const;

/** GET /expenses?search&employeeId&clientId&projectId&status&billable&from&to&page&pageSize */
export const ExpenseFilter = z.object({
  search: opt(z.string().max(200)), employeeId: opt(z.string().max(40)), clientId: opt(z.string().max(40)), projectId: opt(z.string().max(40)),
  status: opt(z.string().max(20)), billable: opt(z.enum(['true', 'false']).transform((v) => v === 'true')), from: opt(F.date), to: opt(F.date),
  page: opt(F.page), pageSize: opt(F.pageSize),
});

/** POST /expenses */
export const NewExpense = z.object({
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: 'Choose a category.' }) }),
  description: F.text(300),
  amount: z.number({ required_error: 'Enter an amount.', invalid_type_error: 'Enter an amount.' }),
  date: F.date,
  projectId: z.string().max(40).nullable().default(null),
  billable: z.boolean().default(false),
  receipt: z.boolean().default(false),
});

/** POST /expenses/:id/reopen { reason, amount } */
export const ReopenExpense = z.object({ reason: F.text(500), amount: z.number({ required_error: 'Enter the corrected amount.', invalid_type_error: 'Enter the corrected amount.' }) });

async function load(q: Q, where: { ids?: string[]; employeeIds?: string[] | null; f?: z.infer<typeof ExpenseFilter> }): Promise<ExpenseClaim[]> {
  let qb = q.selectFrom('expenses as x').innerJoin('employees as e', 'e.id', 'x.employeeId').selectAll('x');
  if (where.ids) qb = where.ids.length ? qb.where('x.id', 'in', where.ids) : qb.where(sql<boolean>`false`);
  if (where.employeeIds) qb = where.employeeIds.length ? qb.where('x.employeeId', 'in', where.employeeIds) : qb.where(sql<boolean>`false`);
  const f = where.f;
  if (f?.search?.trim()) {
    const like = '%' + f.search.trim().toLowerCase().replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
    qb = qb.where(sql<boolean>`lower(x.id || ' ' || x.description || ' ' || e.name || ' ' || x.category) LIKE ${like}`);
  }
  if (f?.employeeId) qb = qb.where('x.employeeId', '=', f.employeeId);
  if (f?.clientId) qb = qb.where('x.clientId', '=', f.clientId);
  if (f?.projectId) qb = qb.where('x.projectId', '=', f.projectId);
  if (f?.status) qb = qb.where('x.status', '=', f.status);
  if (f?.billable !== undefined) qb = qb.where('x.billable', '=', f.billable);
  if (f?.from) qb = qb.where('x.date', '>=', f.from);
  if (f?.to) qb = qb.where('x.date', '<=', f.to);
  const rows = await qb.orderBy('x.date', 'desc').orderBy('x.id', 'desc').execute();
  if (!rows.length) return [];
  const revs = await q.selectFrom('expenseRevisions').selectAll().where('expenseId', 'in', rows.map((r) => r.id)).orderBy('id').execute();
  return rows.map((r) => ({
    id: r.id, employeeId: r.employeeId, category: r.category as ExpenseClaim['category'], description: r.description, amount: toRupees(r.amountPaise), date: r.date,
    projectId: r.projectId, clientId: r.clientId, billable: r.billable, receipt: r.receipt, status: r.status as ExpenseClaim['status'], submitted: r.submitted,
    reimbursedOn: r.reimbursedOn, approvalId: r.approvalId,
    revisions: revs.filter((v) => v.expenseId === r.id).map((v) => ({ at: v.at, amount: toRupees(v.amountPaise), description: v.description, status: v.status as ExpenseClaim['status'], reason: v.reason })),
  }));
}

export async function listExpenses(actor: Actor, f: z.infer<typeof ExpenseFilter>): Promise<Paginated<ExpenseClaim>> {
  const page = f.page ?? 1, pageSize = f.pageSize ?? 1000;
  const ids = can(actor, 'expenses', 'view') ? await visibleEmployeeIds(db, actor, 'expenses') : actor.employeeId ? [actor.employeeId] : [];
  const all = await load(db, { employeeIds: ids, f });
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

/** One claim: the owner's, within the actor's expenses scope, or one they are asked to approve; otherwise 404. */
export async function getExpense(actor: Actor, id: string): Promise<ExpenseClaim> {
  const [x] = await load(db, { ids: [id] });
  if (!x) throw notFound('Claim not found');
  if (x.employeeId !== actor.employeeId) {
    const ids = can(actor, 'expenses', 'view') ? await visibleEmployeeIds(db, actor, 'expenses') : [];
    // Anyone asked to approve the claim (e.g. Finance) can open it, as they can in the approval queue.
    const approver = x.approvalId && actor.employeeId
      ? await db.selectFrom('approvals').select('id').where('id', '=', x.approvalId).where(sql<boolean>`plan @> ${JSON.stringify([{ approverId: actor.employeeId }])}::jsonb`).executeTakeFirst()
      : null;
    if (ids && !ids.includes(x.employeeId) && !approver) throw notFound('Claim not found');
  }
  return x;
}

export async function submitExpense(actor: Actor, input: z.infer<typeof NewExpense>): Promise<ExpenseClaim> {
  const me = selfId(actor); // anyone may claim their own expenses
  if (!(input.amount > 0)) throw unprocessable('Enter an amount.', { amount: 'Required' });
  if (!input.description.trim()) throw unprocessable('Describe the expense.', { description: 'Required' });
  if (input.date > today()) throw unprocessable('The expense date can’t be in the future.', { date: 'In the future' });
  return withTransaction(actor, async (tx) => {
    const proj = input.projectId ? await tx.db.selectFrom('projects').select(['id', 'clientId']).where('id', '=', input.projectId).executeTakeFirst() : null;
    if (input.projectId && !proj) throw unprocessable('Choose a project from the list.', { projectId: 'Unknown' });
    if (input.billable && !proj) throw unprocessable('A billable claim needs a project, so it can be invoiced to its client.', { projectId: 'Required' });
    await sql`SELECT pg_advisory_xact_lock(hashtext('riona.expense-ids'))`.execute(tx.db);
    const last = await tx.db.selectFrom('expenses').select(sql<number>`max(substring(id from 5)::int)`.as('n')).where('id', '~', '^EXP-\\d+$').executeTakeFirst();
    const id = 'EXP-' + String((last?.n ?? 699) + 1).padStart(4, '0');
    await tx.db.insertInto('expenses').values({
      id, employeeId: me, category: input.category, description: input.description.trim(), amountPaise: toPaise(input.amount), date: input.date,
      projectId: proj?.id ?? null, clientId: proj?.clientId ?? null, billable: input.billable, receipt: input.receipt, status: 'Pending', submitted: today(),
    }).execute();
    const ap = await openApproval(tx, { type: 'Expense', sourceId: id, requesterId: me, facts: { amount: input.amount, category: input.category } });
    await tx.db.updateTable('expenses').set({ approvalId: ap.id }).where('id', '=', id).execute();
    await tx.audit('Created', 'Expense claim', id, [{ field: 'amount', before: null, after: String(input.amount) }]);
    return (await load(tx.db, { ids: [id] }))[0];
  });
}

/** POST /expenses/:id/reopen — the owner or Admin corrects an approved claim; it goes through approval again. */
export async function reopenExpense(actor: Actor, id: string, reason: string, amount: number): Promise<ExpenseClaim> {
  return withTransaction(actor, async (tx) => {
    const x = await tx.db.selectFrom('expenses').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!x) throw notFound('Claim not found');
    if (x.employeeId !== actor.employeeId && !can(actor, 'expenses', 'approve')) throw forbidden('Only the person who claimed it, or an Admin, can reopen a claim.');
    if (x.employeeId !== actor.employeeId) authorize(actor, 'finance', 'approve');
    if (x.status !== 'Approved' && x.status !== 'Reimbursed') throw conflict('Only an approved claim can be reopened.');
    if (reason.trim().length < 5) throw unprocessable('Say why the claim is being reopened.', { reason: 'Too short' });
    if (!(amount > 0)) throw unprocessable('Enter the corrected amount.', { amount: 'Required' });
    const onInvoice = await tx.db.selectFrom('invoiceLineExpenses').select('invoiceId').where('expenseId', '=', id).where('live', '=', true).executeTakeFirst();
    if (onInvoice) throw conflict(`This claim is billed on ${onInvoice.invoiceId}. Revise the invoice instead.`);
    const hasRevisions = await tx.db.selectFrom('expenseRevisions').select('id').where('expenseId', '=', id).executeTakeFirst();
    if (!hasRevisions) {
      await tx.db.insertInto('expenseRevisions').values({ expenseId: id, at: x.submitted + 'T10:00:00+05:30', amountPaise: x.amountPaise, description: x.description, status: x.status, reason: '' }).execute();
    }
    await tx.db.insertInto('expenseRevisions').values({ expenseId: id, at: nowIso(), amountPaise: toPaise(amount), description: x.description, status: 'Pending', reason: reason.trim() }).execute();
    await tx.db.updateTable('expenses').set({ amountPaise: toPaise(amount), status: 'Pending' }).where('id', '=', id).execute();
    const ap = await openApproval(tx, { type: 'Expense', sourceId: id, requesterId: x.employeeId, facts: { amount, category: x.category } });
    await tx.db.updateTable('expenses').set({ approvalId: ap.id }).where('id', '=', id).execute();
    await tx.audit('Reopened', 'Expense claim', id, [{ field: 'amount', before: String(toRupees(x.amountPaise)), after: String(amount) }, { field: 'reason', before: null, after: reason.trim() }]);
    return (await load(tx.db, { ids: [id] }))[0];
  });
}

export const expenseOutcome: OutcomeHandler = {
  loadSources: async (q, ids) => new Map((await load(q, { ids })).map((x) => [x.id, { kind: 'Expense' as const, expense: x }])),
  apply: async (tx, a) => {
    await tx.db.updateTable('expenses').set({ status: a.status }).where('id', '=', a.sourceId).where('status', '=', 'Pending').execute();
  },
};
