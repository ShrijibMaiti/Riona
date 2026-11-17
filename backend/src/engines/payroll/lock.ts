/**
 * The payroll calendar. Inputs for a month lock on the 25th: an event recorded after that reaches the month only
 * "as corrected", and is paid in the next run. A disbursed run is closed: its payslips are frozen and the database
 * refuses any change to it (003, riona_closed_run_guard).
 */
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/schema';
import { conflict } from '../../lib/errors';

export const lockDateOf = (ym: string) => ym + '-25';
export const ymOf = (d: string) => d.slice(0, 7);
export const nextYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
export const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = ymOf(from); m <= ymOf(to); m = nextYm(m)) out.push(m);
  return out;
}

/** The month whose run first sees something recorded on `recorded` for month `ym`: that month, or the next if after its lock. */
export const paidIn = (ym: string, recorded: string) => (recorded <= lockDateOf(ym) ? ym : nextYm(ym));

/** Throws 409 if the month's run is disbursed (closed). */
export async function assertRunOpen(q: Kysely<DB> | Transaction<DB>, month: string) {
  const run = await q.selectFrom('payrollRuns').select('stage').where('month', '=', month).executeTakeFirst();
  if (run?.stage === 'Disbursed') throw conflict(`The ${month} payroll run is closed.`, 'payroll.run_closed');
}
