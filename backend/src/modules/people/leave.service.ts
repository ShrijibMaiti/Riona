/**
 * Leave types and leave requests. Requests are personal: HR and Admin see everyone's, a manager their team's, an
 * employee their own. Applying opens an approval (engines/approvals); cancelling a pending request withdraws it.
 */
import type { LeaveRequest, LeaveType } from '@riona/shared';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { LeaveRequests } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, selfId } from '../../auth/rbac/authorize';
import { openApproval, withdraw } from '../../engines/approvals/engine';
import type { OutcomeHandler } from '../../engines/approvals/outcomes';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { today } from '../../lib/dates';
import { visibleEmployeeIds } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { F, opt } from '../../lib/validate';

/** GET /leave-requests?employeeId&status&from&to — from/to select requests overlapping that range. */
export const LeaveQuery = z.object({
  employeeId: opt(z.string().max(40)),
  status: opt(z.enum(['Pending', 'Approved', 'Rejected', 'Cancelled'])),
  from: opt(F.date),
  to: opt(F.date),
});

export async function getLeaveTypes(): Promise<LeaveType[]> {
  const rows = await db.selectFrom('leaveTypes').selectAll().orderBy('code').execute();
  return rows.map((r) => ({
    code: r.code as LeaveType['code'], name: r.name, accrual: r.accrual, entitlement: r.entitlement, carryForwardCap: r.carryForwardCap,
    encashment: r.encashment, appliesTo: r.appliesTo,
  }));
}

export async function getLeaveRequests(actor: Actor, f: z.infer<typeof LeaveQuery>): Promise<LeaveRequest[]> {
  authorize(actor, 'leave', 'view');
  const ids = await visibleEmployeeIds(db, actor, 'leave');
  if (ids && !ids.length) return [];
  if (f.employeeId && ids && !ids.includes(f.employeeId)) return [];
  let q = db.selectFrom('leaveRequests').selectAll();
  if (f.employeeId) q = q.where('employeeId', '=', f.employeeId);
  else if (ids) q = q.where('employeeId', 'in', ids);
  if (f.status) q = q.where('status', '=', f.status);
  if (f.from) q = q.where('to', '>=', f.from);
  if (f.to) q = q.where('from', '<=', f.to);
  return (await q.orderBy('from', 'desc').orderBy('id').execute()).map(toLeave);
}

// ---------------- applying and cancelling (through the approval engine) ----------------

/** POST /leave-requests */
export const ApplyLeave = z.object({
  type: z.enum(['CL', 'SL', 'EL', 'CO', 'ML', 'PL'], { errorMap: () => ({ message: 'Choose a leave type.' }) }),
  from: F.date,
  to: F.date,
  reason: F.text(500).default(''),
  days: z.number({ invalid_type_error: 'Choose at least half a day.' }).positive('Choose at least half a day.').max(180).multipleOf(0.5, 'Use whole or half days.'),
});

const toLeave = (r: Selectable<LeaveRequests>): LeaveRequest => ({
  id: r.id, employeeId: r.employeeId, type: r.type as LeaveRequest['type'], from: r.from, to: r.to, days: r.days, reason: r.reason,
  submitted: r.submitted, status: r.status as LeaveRequest['status'], approvalId: r.approvalId,
});

export async function applyLeave(actor: Actor, input: z.infer<typeof ApplyLeave>): Promise<LeaveRequest> {
  const me = selfId(actor);
  if (input.to < input.from) throw unprocessable('The end date is before the start date.', { to: 'Before from' });
  return withTransaction(actor, async (tx) => {
    const overlap = await tx.db.selectFrom('leaveRequests').select('id').where('employeeId', '=', me).where('status', 'in', ['Pending', 'Approved'])
      .where('from', '<=', input.to).where('to', '>=', input.from).executeTakeFirst();
    if (overlap) throw conflict('You already have leave on some of these days.');
    const id = newId('LV');
    await tx.db.insertInto('leaveRequests').values({ id, employeeId: me, type: input.type, from: input.from, to: input.to, days: input.days, reason: input.reason, submitted: today(), status: 'Pending' }).execute();
    const ap = await openApproval(tx, { type: 'Leave', sourceId: id, requesterId: me, facts: { days: input.days, type: input.type } });
    await tx.db.updateTable('leaveRequests').set({ approvalId: ap.id }).where('id', '=', id).execute();
    await tx.audit('Created', 'Leave request', id, [{ field: 'days', before: null, after: `${input.days} · ${input.type} · ${input.from} to ${input.to}` }]);
    return toLeave((await tx.db.selectFrom('leaveRequests').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
  });
}

/** POST /leave-requests/:id/cancel — your own request, while pending or before it starts. */
export async function cancelLeave(actor: Actor, id: string): Promise<LeaveRequest> {
  const me = selfId(actor);
  return withTransaction(actor, async (tx) => {
    const l = await tx.db.selectFrom('leaveRequests').selectAll().where('id', '=', id).where('employeeId', '=', me).forUpdate().executeTakeFirst();
    if (!l) throw notFound('Not found');
    if (l.status === 'Cancelled' || l.status === 'Rejected') throw conflict(`This request is already ${l.status.toLowerCase()}.`);
    if (l.status === 'Approved' && l.from <= today()) throw conflict('This leave has already started. Ask HR to change it.');
    await withdraw(tx, l.status === 'Pending' ? l.approvalId : null);
    await tx.db.updateTable('leaveRequests').set({ status: 'Cancelled' }).where('id', '=', id).execute();
    await tx.audit('Cancelled', 'Leave request', id, [{ field: 'status', before: l.status, after: 'Cancelled' }]);
    return toLeave({ ...l, status: 'Cancelled' });
  });
}

/** The approval engine's side of leave: the queue embeds the request; the decision sets its status. */
export const leaveOutcome: OutcomeHandler = {
  loadSources: async (q, ids) => {
    const rows = ids.length ? await q.selectFrom('leaveRequests').selectAll().where('id', 'in', ids).execute() : [];
    return new Map(rows.map((r) => [r.id, { kind: 'Leave' as const, leave: toLeave(r) }]));
  },
  apply: async (tx, a) => {
    await tx.db.updateTable('leaveRequests').set({ status: a.status }).where('id', '=', a.sourceId).where('status', '=', 'Pending').execute();
  },
};
