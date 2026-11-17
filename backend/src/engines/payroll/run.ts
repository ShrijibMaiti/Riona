/**
 * Payroll runs: one per month, moving Inputs → Review → Approved → Disbursed.
 *  - Leaving Inputs fixes the run's inputs: who is paid, which salary events count (recorded by the lock date),
 *    and the attendance range that loss-of-pay is read from.
 *  - Disbursing freezes every person's payslip (the `payslips` table, append-only) and closes the run: the
 *    database refuses any later change to it.
 */
import type { AttendanceDay, PayrollRun } from '@riona/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DB, PayrollRuns } from '../../db/schema';
import type { Tx } from '../../db/tx';
import { conflict, notFound } from '../../lib/errors';
import { today } from '../../lib/dates';
import { toPaise } from '../../lib/money';
import { toEmployee } from '../../modules/people/employees.repo';
import { loadEvents } from './ledger';
import { lockDateOf } from './lock';
import { lopDays, runLine, type RunLine } from './payslip';

type Q = Kysely<DB> | Transaction<DB>;
export const STAGES = ['Inputs', 'Review', 'Approved', 'Disbursed'] as const;

export const toRun = (r: Selectable<PayrollRuns>): PayrollRun => ({
  id: r.id, month: r.month, stage: r.stage as PayrollRun['stage'], lockDate: r.lockDate, disbursedOn: r.disbursedOn,
  employeeIds: r.employeeIds as string[], salaryEventIds: r.salaryEventIds as string[], attendanceFrom: r.attendanceFrom, attendanceTo: r.attendanceTo,
  bankFileIssues: r.bankFileIssues as PayrollRun['bankFileIssues'],
});

const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** A run's inputs as of `asOf`: people employed by the month's end, events effective by then and recorded by the lock. */
export async function runInputs(q: Q, month: string, asOf: string) {
  const end = monthEnd(month);
  const recordedBy = asOf < lockDateOf(month) ? asOf : lockDateOf(month);
  const employeeIds = (await q.selectFrom('employees').select('id').where('joined', '<=', end).orderBy('id').execute()).map((e) => e.id);
  const salaryEventIds = employeeIds.length
    ? (await q.selectFrom('salaryEvents').select('id').where('employeeId', 'in', employeeIds).where('effective', '<=', end).where('recorded', '<=', recordedBy).orderBy('seq').execute()).map((e) => e.id)
    : [];
  return { employeeIds, salaryEventIds, attendanceFrom: month + '-01', attendanceTo: asOf < end ? asOf : end };
}

/** Every person's line in a run, computed from the run's own inputs (as paid). */
export async function computeLines(q: Q, run: PayrollRun): Promise<RunLine[]> {
  if (!run.employeeIds.length) return [];
  const emps = (await q.selectFrom('employees').selectAll().where('id', 'in', run.employeeIds).execute()).map(toEmployee);
  const events = await loadEvents(q, { ids: run.salaryEventIds });
  const att = await q.selectFrom('attendance').select(['employeeId', 'date', 'mark']).where('employeeId', 'in', run.employeeIds)
    .where('date', '>=', run.attendanceFrom).where('date', '<=', run.attendanceTo).execute();
  return run.employeeIds.flatMap((id) => {
    const emp = emps.find((e) => e.id === id);
    if (!emp) return [];
    const mine = att.filter((a) => a.employeeId === id).map((a) => ({ date: a.date, mark: a.mark }) as AttendanceDay);
    return [runLine(emp, events.filter((e) => e.employeeId === id), run.month, lopDays(mine, run.month))];
  });
}

/** A disbursed run's frozen lines, in the run's order; any other run's computed live. */
export async function linesOf(q: Q, run: PayrollRun): Promise<RunLine[]> {
  if (run.stage !== 'Disbursed') return computeLines(q, run);
  const frozen = await q.selectFrom('payslips').select(['employeeId', 'slip']).where('runId', '=', run.id).execute();
  const byEmp = new Map(frozen.map((p) => [p.employeeId, p.slip as unknown as RunLine]));
  return run.employeeIds.flatMap((id) => (byEmp.has(id) ? [byEmp.get(id)!] : []));
}

export async function getRunRow(q: Q, id: string) {
  const r = await q.selectFrom('payrollRuns').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw notFound('Payroll run not found');
  return toRun(r);
}

/** Moves a run to its next stage, in the caller's transaction. */
export async function advanceRun(tx: Tx, id: string): Promise<PayrollRun> {
  const row = await tx.db.selectFrom('payrollRuns').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!row) throw notFound('Payroll run not found');
  const run = toRun(row);
  const i = STAGES.indexOf(run.stage);
  if (run.stage === 'Disbursed') throw conflict('This run is already disbursed.');
  const next = STAGES[i + 1];
  const now = today();

  if (run.stage === 'Inputs') {
    // Inputs lock: from here on the run is computed from exactly these people, events and days.
    const inputs = await runInputs(tx.db, run.month, now);
    await tx.db.updateTable('payrollRuns').set({ stage: next, employeeIds: JSON.stringify(inputs.employeeIds), salaryEventIds: JSON.stringify(inputs.salaryEventIds), attendanceFrom: inputs.attendanceFrom, attendanceTo: inputs.attendanceTo }).where('id', '=', id).execute();
  } else if (next === 'Disbursed') {
    const lines = await computeLines(tx.db, run);
    if (lines.length) {
      await tx.db.insertInto('payslips').values(lines.map((l) => ({ runId: id, employeeId: l.employeeId, month: run.month, slip: JSON.stringify(l), netPaise: toPaise(l.net), frozenAt: now }))).execute();
    }
    await tx.db.updateTable('payrollRuns').set({ stage: next, disbursedOn: now }).where('id', '=', id).execute();
    await tx.notify({ recipientIds: lines.map((l) => l.employeeId), kind: 'Payroll', text: `Your payslip for ${run.month} is ready.`, href: '/app/me/payslips' });
  } else {
    await tx.db.updateTable('payrollRuns').set({ stage: next }).where('id', '=', id).execute();
  }
  await tx.audit('Updated', 'Payroll run', id, [{ field: 'stage', before: run.stage, after: next }]);
  return getRunRow(tx.db, id);
}
