/**
 * Attendance regularisations: a correction to one day's mark, approved by the reporting manager. When approved,
 * the day's mark changes and the original is kept in attendance.regularised_from.
 */
import type { RegularisationRequest } from '@riona/shared';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { Regularisations } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, selfId } from '../../auth/rbac/authorize';
import { visibleEmployeeIds } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { openApproval } from '../../engines/approvals/engine';
import type { OutcomeHandler } from '../../engines/approvals/outcomes';
import { conflict, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { today } from '../../lib/dates';
import { F, opt } from '../../lib/validate';

const MARKS = ['P', 'Late', 'Half day', 'Leave', 'Absent', 'Holiday', 'Weekend', 'WFH'] as const;
const hm = z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 09:30.');

export const RegularisationQuery = z.object({ employeeId: opt(z.string().max(40)) });

/** POST /regularisations */
export const NewRegularisation = z.object({
  date: F.date,
  requestedMark: z.enum(MARKS, { errorMap: () => ({ message: 'Choose what the day should be.' }) }),
  requestedIn: hm.nullable().default(null),
  requestedOut: hm.nullable().default(null),
  reason: F.text(500).min(3, 'Say what happened.'),
});

const toReg = (r: Selectable<Regularisations>): RegularisationRequest => ({
  id: r.id, employeeId: r.employeeId, date: r.date, recorded: r.recorded, requested: r.requested, reason: r.reason,
  requestedMark: r.requestedMark as RegularisationRequest['requestedMark'], requestedIn: r.requestedIn, requestedOut: r.requestedOut, approvalId: r.approvalId ?? '',
});

/** GET /regularisations?employeeId — scoped like attendance: own, team, or everyone for HR and Admin. */
export async function getRegularisations(actor: Actor, f: z.infer<typeof RegularisationQuery>): Promise<RegularisationRequest[]> {
  authorize(actor, 'attendance', 'view');
  const ids = await visibleEmployeeIds(db, actor, 'attendance');
  if (ids && (!ids.length || (f.employeeId && !ids.includes(f.employeeId)))) return [];
  let q = db.selectFrom('regularisations').selectAll().where('status', '!=', 'Withdrawn');
  if (f.employeeId) q = q.where('employeeId', '=', f.employeeId);
  else if (ids) q = q.where('employeeId', 'in', ids);
  return (await q.orderBy('date', 'desc').orderBy('id').execute()).map(toReg);
}

export async function requestRegularisation(actor: Actor, input: z.infer<typeof NewRegularisation>): Promise<RegularisationRequest> {
  const me = selfId(actor);
  if (input.date > today()) throw unprocessable('You can only correct a day that has passed.', { date: 'In the future' });
  if (input.requestedIn && input.requestedOut && input.requestedOut <= input.requestedIn) throw unprocessable('The out time is before the in time.', { requestedOut: 'Before in' });
  return withTransaction(actor, async (tx) => {
    const waiting = await tx.db.selectFrom('regularisations').select('id').where('employeeId', '=', me).where('date', '=', input.date).where('status', '=', 'Pending').executeTakeFirst();
    if (waiting) throw conflict('A correction for this day is already waiting on your manager.');
    const att = await tx.db.selectFrom('attendance').selectAll().where('employeeId', '=', me).where('date', '=', input.date).executeTakeFirst();
    const recorded = att ? att.mark + (att.inTime ? ' · ' + att.inTime + '–' + (att.outTime ?? '') : '') : 'No record';
    const requested = input.requestedMark + (input.requestedIn ? ' · ' + input.requestedIn + '–' + (input.requestedOut ?? '') : '');
    const id = newId('RG');
    await tx.db.insertInto('regularisations').values({ id, employeeId: me, ...input, recorded, requested, status: 'Pending' }).execute();
    const ap = await openApproval(tx, { type: 'Regularisation', sourceId: id, requesterId: me, facts: { mark: input.requestedMark } });
    await tx.db.updateTable('regularisations').set({ approvalId: ap.id }).where('id', '=', id).execute();
    await tx.audit('Created', 'Regularisation', id, [{ field: input.date, before: recorded, after: requested }]);
    return toReg((await tx.db.selectFrom('regularisations').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
  });
}

export const regularisationOutcome: OutcomeHandler = {
  loadSources: async (q, ids) => {
    const rows = ids.length ? await q.selectFrom('regularisations').selectAll().where('id', 'in', ids).execute() : [];
    return new Map(rows.map((r) => [r.id, { kind: 'Regularisation' as const, reg: toReg(r) }]));
  },
  apply: async (tx, a) => {
    const r = await tx.db.selectFrom('regularisations').selectAll().where('id', '=', a.sourceId).executeTakeFirst();
    if (!r) return;
    await tx.db.updateTable('regularisations').set({ status: a.status }).where('id', '=', r.id).execute();
    if (a.status !== 'Approved') return;
    const att = await tx.db.selectFrom('attendance').selectAll().where('employeeId', '=', r.employeeId).where('date', '=', r.date).forUpdate().executeTakeFirst();
    const mark = { mark: r.requestedMark, inTime: r.requestedIn, outTime: r.requestedOut };
    if (att) {
      // Keep the very first mark, even if a day is corrected twice.
      await tx.db.updateTable('attendance').set({ ...mark, regularisedFrom: att.regularisedFrom ?? att.mark }).where('id', '=', att.id).execute();
    } else {
      await tx.db.insertInto('attendance').values({ id: newId('AT'), employeeId: r.employeeId, date: r.date, ...mark, regularisedFrom: 'Absent' }).execute();
    }
    await tx.audit('Regularised', 'Attendance', `${r.employeeId} ${r.date}`, [{ field: 'mark', before: att?.mark ?? null, after: r.requestedMark }]);
  },
};
