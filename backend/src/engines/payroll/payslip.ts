/**
 * One month's payslip, rebuilt from the salary ledger. Two views of the same ledger:
 *   corrected  every event applied to the month it belongs to (a retro correction lands in its months)
 *   asPaid     what was actually paid: only events recorded before that month's lock; corrections arrive later,
 *              as arrears, in the run that first saw them
 * The frontend renders the same figures (frontend/app/src/data/selectors/payroll.ts); a test keeps them identical.
 * Rupees, rounded to the rupee as on the payslip.
 */
import type { AttendanceDay, Employee, Estimated, SalaryEvent } from '@riona/shared';
import { rulesFor } from './statutory/rules';
import { pfFor } from './statutory/pf';
import { esiFor, esiNote } from './statutory/esi';
import { ptFor } from './statutory/pt';
import { monthlyTds } from './statutory/tds';
import { lockDateOf, paidIn, ymOf } from './lock';

export type PayslipMode = 'corrected' | 'asPaid';
export type PayslipLine = { key: string; label: string; amount: number; estimated?: Estimated };
export type Payslip = {
  month: string; mode: PayslipMode; ctc: number; ctcSince: SalaryEvent | null;
  earnings: PayslipLine[]; deductions: PayslipLine[]; gross: number; totalDeductions: number; net: number;
  /** Events that shaped this month's figures. */
  eventIds: string[];
  esiNote: string;
};

const counted = (e: SalaryEvent, month: string, mode: PayslipMode) => mode === 'corrected' || e.recorded <= lockDateOf(month);

/** The annual CTC in force for a month, and the event that set it. */
export function ctcFor(events: SalaryEvent[], month: string, mode: PayslipMode = 'corrected'): { ctc: number; since: SalaryEvent | null } {
  let ctc = 0;
  let since: SalaryEvent | null = null;
  for (const e of [...events].sort((a, b) => a.effective.localeCompare(b.effective))) {
    if (e.ctc && ymOf(e.effective) <= month && counted(e, month, mode)) {
      ctc = e.ctc;
      since = e;
    }
  }
  return { ctc, since };
}

export function payslip(emp: Pick<Employee, 'state' | 'type'>, events: SalaryEvent[], month: string, mode: PayslipMode = 'corrected', lopDays = 0, workingDays = 22): Payslip {
  const rules = rulesFor(month);
  const { ctc, since } = ctcFor(events, month, mode);
  const mo = ctc / 12;
  const basic = Math.round(mo * 0.4);
  let hra = Math.round(basic * 0.5);
  const pf = pfFor(basic, rules);
  let special = Math.round(mo - basic - hra - pf);
  let bonus = 0, arrear = 0, rec = 0;
  let arrearLabel = 'Arrears';
  const used: string[] = since ? [since.id] : [];
  for (const e of events) {
    if (e.type === 'Correction') {
      if (mode === 'corrected' && e.appliesTo?.includes(month)) {
        if (e.component === 'HRA') hra += e.amount ?? 0;
        else special += e.amount ?? 0;
        used.push(e.id);
      }
      // As paid: the whole correction arrives as arrears in the first run whose lock falls after it was recorded.
      if (mode === 'asPaid' && paidIn(ymOf(e.recorded), e.recorded) === month) {
        arrear += (e.amount ?? 0) * (e.appliesTo?.length ?? 0);
        arrearLabel = (e.component ?? 'Salary') + ' arrears';
        used.push(e.id);
      }
      continue;
    }
    if (e.type !== 'Bonus' && e.type !== 'Deduction') continue;
    // One-off events land in their effective month (corrected), or the run that first saw them (as paid).
    const lands = mode === 'corrected' ? ymOf(e.effective) : paidIn(ymOf(e.effective), e.recorded);
    if (lands !== month) continue;
    if (e.type === 'Bonus') bonus += e.amount ?? 0;
    else rec += e.amount ?? 0;
    used.push(e.id);
  }
  const contract = emp.type !== 'Full-time';
  const lop = lopDays > 0 ? Math.round(((basic + hra + special) / workingDays) * lopDays) : 0;
  const recurring = basic + hra + special;
  const extra = bonus + arrear;
  const tds: Estimated = {
    value: monthlyTds(recurring, extra, contract, rules), estimated: true,
    basis: contract ? 'Section 194J at 10% of fees' : 'New regime, projected on this month’s salary × 12; declarations not applied',
  };
  const pt = contract ? 0 : ptFor(emp.state, rules);

  const earnings: PayslipLine[] = [
    { key: 'basic', label: 'Basic', amount: basic },
    { key: 'hra', label: 'House rent allowance', amount: hra },
    { key: 'special', label: 'Special allowance', amount: special },
    { key: 'bonus', label: 'Festival bonus', amount: bonus },
    { key: 'arrear', label: arrearLabel, amount: arrear },
    { key: 'lop', label: 'Loss of pay · ' + lopDays + (lopDays === 1 ? ' day' : ' days'), amount: -lop },
  ].filter((x) => x.amount);
  const deductions: PayslipLine[] = [
    { key: 'pf', label: 'Provident fund (PF) · 12% of basic, capped', amount: contract ? 0 : pf },
    { key: 'pt', label: 'Professional tax (PT) · ' + emp.state, amount: pt },
    { key: 'tds', label: contract ? 'TDS · Section 194J' : 'Income tax (TDS) · new regime', amount: tds.value, estimated: tds },
    { key: 'rec', label: 'Recovery', amount: rec },
  ].filter((x) => x.amount);
  const gross = earnings.reduce((a, x) => a + x.amount, 0);
  const totalDeductions = deductions.reduce((a, x) => a + x.amount, 0);
  return { month, mode, ctc, ctcSince: since, earnings, deductions, gross, totalDeductions, net: gross - totalDeductions, eventIds: used, esiNote: esiNote(gross, rules) };
}

/** Loss-of-pay days from attendance: an absence counts 1, a half day 0.5. */
export function lopDays(att: AttendanceDay[], month: string) {
  return att.filter((a) => a.date.startsWith(month)).reduce((s, a) => s + (a.mark === 'Absent' ? 1 : a.mark === 'Half day' ? 0.5 : 0), 0);
}

/** One run line: the payslip plus what the run reports per person (ESI is computed on the gross). */
export function runLine(emp: Pick<Employee, 'id' | 'name' | 'state' | 'type' | 'dept'>, events: SalaryEvent[], month: string, lop: number, mode: PayslipMode = 'asPaid') {
  const slip = payslip(emp, events, month, mode, lop);
  const pick = (k: string) => slip.deductions.find((d) => d.key === k)?.amount ?? 0;
  const esi = esiFor(slip.gross, rulesFor(month));
  return { employeeId: emp.id, name: emp.name ?? emp.id, dept: emp.dept, slip, lop, pf: pick('pf'), esi, pt: pick('pt'), tds: pick('tds'), net: slip.net - esi };
}
export type RunLine = ReturnType<typeof runLine>;
