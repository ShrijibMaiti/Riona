/**
 * The salary ledger: append-only (the database refuses UPDATE and DELETE, 010). appendSalaryEvent is the only
 * way salary changes. Reading returns events in the order they were written, which is the order the payslip
 * replays them in.
 */
import type { SalaryEvent } from '@riona/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { z } from 'zod';
import type { DB, SalaryEvents } from '../../db/schema';
import type { Tx } from '../../db/tx';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { today } from '../../lib/dates';
import { toPaise, toRupees } from '../../lib/money';
import { F } from '../../lib/validate';
import { ymOf } from './lock';

type Q = Kysely<DB> | Transaction<DB>;

export function toSalaryEvent(r: Selectable<SalaryEvents>): SalaryEvent {
  return {
    id: r.id, employeeId: r.employeeId, type: r.type as SalaryEvent['type'], effective: r.effective, recorded: r.recorded,
    ...(r.ctcPaise !== null ? { ctc: toRupees(r.ctcPaise) } : {}),
    ...(r.amountPaise !== null ? { amount: toRupees(r.amountPaise) } : {}),
    ...(r.appliesTo ? { appliesTo: r.appliesTo } : {}),
    ...(r.component ? { component: r.component as SalaryEvent['component'] } : {}),
    actorId: r.actorId ?? '', note: r.note,
    ...(r.title ? { title: r.title } : {}),
  };
}

/** Events in ledger order, for some employees and/or some event ids (both optional). */
export async function loadEvents(q: Q, where: { employeeIds?: string[]; ids?: string[] } = {}): Promise<SalaryEvent[]> {
  let qb = q.selectFrom('salaryEvents').selectAll();
  if (where.employeeIds) {
    if (!where.employeeIds.length) return [];
    qb = qb.where('employeeId', 'in', where.employeeIds);
  }
  if (where.ids) {
    if (!where.ids.length) return [];
    qb = qb.where('id', 'in', where.ids);
  }
  return (await qb.orderBy('seq').execute()).map(toSalaryEvent);
}

const YM = z.string().regex(/^\d{4}-\d{2}$/, 'Use months like 2026-08.');

/** POST /employees/:id/salary-events */
export const NewSalaryEvent = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['Hired', 'Revised', 'Promotion']), effective: F.date, ctc: z.number({ required_error: 'Enter the new annual CTC.', invalid_type_error: 'Enter the new annual CTC.' }).positive('Enter the new annual CTC.').max(1e9), note: F.text(500).default(''), title: F.text(120).optional() }),
  z.object({ type: z.enum(['Bonus', 'Deduction']), effective: F.date, amount: z.number({ required_error: 'Enter an amount.', invalid_type_error: 'Enter an amount.' }).positive('Enter an amount above zero.').max(1e8), note: F.text(500).default('') }),
  z.object({
    type: z.literal('Correction'), effective: F.date,
    amount: z.number({ required_error: 'Enter the monthly amount.', invalid_type_error: 'Enter the monthly amount.' }).positive('Enter the monthly amount.').max(1e7),
    appliesTo: z.array(YM).min(1, 'Choose the months it corrects.').max(24),
    component: z.enum(['HRA', 'Special allowance'], { errorMap: () => ({ message: 'Choose what it corrects.' }) }),
    note: F.text(500).default(''),
  }),
], { errorMap: () => ({ message: 'Choose what kind of change this is.' }) });
export type NewSalaryEventInput = z.infer<typeof NewSalaryEvent>;

/** Appends one event to an employee's ledger, in the caller's transaction, and audits it. */
export async function appendSalaryEvent(tx: Tx, employeeId: string, input: NewSalaryEventInput): Promise<SalaryEvent> {
  const emp = await tx.db.selectFrom('employees').select(['id', 'joined']).where('id', '=', employeeId).forUpdate().executeTakeFirst();
  if (!emp) throw notFound('Employee not found');
  if (!input.effective.endsWith('-01')) throw unprocessable('A salary change takes effect from the 1st of a month.', { effective: 'Not the 1st' });
  if (ymOf(input.effective) < ymOf(emp.joined)) throw unprocessable('That’s before they joined.', { effective: 'Before joining' });
  const now = today();
  if (input.type === 'Hired' && (await tx.db.selectFrom('salaryEvents').select('id').where('employeeId', '=', employeeId).where('type', '=', 'Hired').executeTakeFirst())) {
    throw conflict('They already have a hiring record. Record a revision instead.');
  }
  if (input.type !== 'Hired' && !(await tx.db.selectFrom('salaryEvents').select('id').where('employeeId', '=', employeeId).where('ctcPaise', 'is not', null).executeTakeFirst())) {
    throw unprocessable('Record their hiring CTC first.');
  }
  if (input.type === 'Correction') {
    if (input.appliesTo.some((m) => m > ymOf(now))) throw unprocessable('A correction is for months already paid or running.', { appliesTo: 'In the future' });
    if (input.appliesTo.some((m) => m < ymOf(emp.joined))) throw unprocessable('That’s before they joined.', { appliesTo: 'Before joining' });
  }
  const id = newId('SE');
  await tx.db.insertInto('salaryEvents').values({
    id, employeeId, type: input.type, effective: input.effective, recorded: now, actorId: tx.actor.employeeId, note: input.note,
    ctcPaise: 'ctc' in input ? toPaise(input.ctc) : null,
    amountPaise: 'amount' in input ? toPaise(input.amount) : null,
    appliesTo: input.type === 'Correction' ? [...new Set(input.appliesTo)].sort() : null,
    component: input.type === 'Correction' ? input.component : null,
    title: 'title' in input ? input.title ?? null : null,
  }).execute();
  const figure = 'ctc' in input ? `CTC ${input.ctc}` : `${input.amount}${input.type === 'Correction' ? ' × ' + input.appliesTo.length + ' months' : ''}`;
  await tx.audit('Created', 'Salary event', id, [{ field: input.type, before: null, after: `${figure} from ${input.effective}` }, { field: 'employee', before: null, after: employeeId }]);
  return toSalaryEvent((await tx.db.selectFrom('salaryEvents').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
}
