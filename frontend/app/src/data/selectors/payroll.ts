import type { AttendanceDay, Employee, Estimated, SalaryEvent } from '../types';

export type PayslipMode = 'corrected' | 'asPaid';
export type PayslipLine = { key: string; label: string; amount: number; estimated?: Estimated };
export type Payslip = {
  month: string;
  mode: PayslipMode;
  ctc: number;
  ctcSince: SalaryEvent | null;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  /** Events that shaped this month's figures. */
  eventIds: string[];
  esiNote: string;
};

/** Payroll inputs lock on the 25th; anything recorded later reached the next run. */
export const lockDateOf = (ym: string) => ym + '-25';
const ymOf = (d: string) => d.slice(0, 7);
const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
export const nextYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = ymOf(from); m <= ymOf(to); m = nextYm(m)) out.push(m);
  return out;
}

/** New-regime income tax with 4% cess, after the ₹75,000 standard deduction; rebate up to ₹12 L. */
export function annualTax(income: number): number {
  const x = Math.max(0, income - 75000);
  if (x <= 1200000) return 0;
  const slabs: [number, number][] = [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [1e12, 0.3]];
  let t = 0, prev = 0;
  for (const [limit, rate] of slabs) {
    if (x > prev) t += (Math.min(x, limit) - prev) * rate;
    prev = limit;
  }
  return t * 1.04;
}

const PT: Record<string, number> = { Karnataka: 200, Maharashtra: 200, 'West Bengal': 200, Kerala: 208, 'Tamil Nadu': 208 };
export const ptFor = (state: string) => PT[state] ?? 200;

/** Is the event visible in this mode for this month's run? */
const counted = (e: SalaryEvent, month: string, mode: PayslipMode) => mode === 'corrected' || e.recorded <= lockDateOf(month);

/** Annual CTC in force for a month. */
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

/**
 * The payslip for one month.
 * `corrected` applies every event to the month it belongs to (retro corrections land in their months).
 * `asPaid` reproduces what was actually paid: only events recorded before that month's lock; corrections arrive later as arrears.
 */
export function payslip(emp: Pick<Employee, 'state' | 'type'>, events: SalaryEvent[], month: string, mode: PayslipMode = 'corrected', lopDays = 0, workingDays = 22): Payslip {
  const { ctc, since } = ctcFor(events, month, mode);
  const mo = ctc / 12;
  const basic = Math.round(mo * 0.4);
  let hra = Math.round(basic * 0.5);
  const pf = Math.min(1800, Math.round(basic * 0.12));
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
      if (mode === 'asPaid') {
        // Paid as arrears in the first run whose lock falls after it was recorded.
        const paidIn = e.recorded <= lockDateOf(ymOf(e.recorded)) ? ymOf(e.recorded) : nextYm(ymOf(e.recorded));
        if (paidIn === month) {
          arrear += (e.amount ?? 0) * (e.appliesTo?.length ?? 0);
          arrearLabel = (e.component ?? 'Salary') + ' arrears';
          used.push(e.id);
        }
      }
      continue;
    }
    if (e.type !== 'Bonus' && e.type !== 'Deduction') continue;
    // One-off events land in their effective month (corrected), or the run that first saw them (as paid).
    const lands = mode === 'corrected' ? ymOf(e.effective) : e.recorded <= lockDateOf(ymOf(e.effective)) ? ymOf(e.effective) : nextYm(ymOf(e.effective));
    if (lands !== month) continue;
    if (e.type === 'Bonus') bonus += e.amount ?? 0;
    else rec += e.amount ?? 0;
    used.push(e.id);
  }
  const contract = emp.type !== 'Full-time';
  const lop = lopDays > 0 ? Math.round(((basic + hra + special) / workingDays) * lopDays) : 0;
  const recurring = basic + hra + special;
  const annual = recurring * 12;
  const extra = bonus + arrear;
  const tdsValue = contract ? Math.round((recurring + extra) * 0.1) : Math.round(annualTax(annual) / 12 + (extra ? annualTax(annual + extra) - annualTax(annual) : 0));
  const tds: Estimated = { value: tdsValue, estimated: true, basis: contract ? 'Section 194J at 10% of fees' : 'New regime, projected on this month’s salary × 12; declarations not applied' };
  const pt = contract ? 0 : ptFor(emp.state);

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
  return {
    month, mode, ctc, ctcSince: since, earnings, deductions, gross, totalDeductions, net: gross - totalDeductions, eventIds: used,
    esiNote: gross > 21000 ? 'ESI not applicable — gross above ₹21,000' : 'ESI at 0.75% applies',
  };
}

/** Months in which the two views of the ledger differ, with the net-pay difference. */
export function correctionDiffs(emp: Pick<Employee, 'state' | 'type'>, events: SalaryEvent[], from: string, to: string) {
  return monthsBetween(from, to)
    .map((m) => ({ month: m, diff: payslip(emp, events, m, 'corrected').net - payslip(emp, events, m, 'asPaid').net }))
    .filter((x) => x.diff !== 0);
}

/** Overhead loading (benefits, seat, equipment, management) and productive hours behind the cost rate. */
export const COST_LOADING = 1.4;
export const PRODUCTIVE_HOURS = 140;
/** Fully loaded hourly cost of an employee, from the CTC in force. Estimated. */
export function costRate(events: SalaryEvent[], date: string): Estimated {
  const { ctc } = ctcFor(events, ymOf(date));
  return { value: Math.round((ctc * COST_LOADING) / 12 / PRODUCTIVE_HOURS), estimated: true, basis: 'Annual CTC × 1.4 overhead loading ÷ 12 ÷ 140 productive hours' };
}

/** Cost-rate lookup for many entries without re-scanning the ledger each time. */
export function makeCostRates(events: SalaryEvent[]) {
  const byEmp = new Map<string, SalaryEvent[]>();
  for (const e of events) byEmp.set(e.employeeId, [...(byEmp.get(e.employeeId) ?? []), e]);
  const memo = new Map<string, number>();
  return (employeeId: string, date: string) => {
    const k = employeeId + ymOf(date);
    let v = memo.get(k);
    if (v === undefined) {
      v = costRate(byEmp.get(employeeId) ?? [], date).value;
      memo.set(k, v);
    }
    return v;
  };
}

/** Loss-of-pay days from attendance: absences count 1, half days 0.5. */
export function lopDays(att: AttendanceDay[], month: string) {
  return att.filter((a) => a.date.startsWith(month)).reduce((s, a) => s + (a.mark === 'Absent' ? 1 : a.mark === 'Half day' ? 0.5 : 0), 0);
}

export { prevYm };

/** Every employee's payslip for a run, computed from the run's events and the month's attendance. */
export function runLines(
  run: { month: string; employeeIds: string[]; salaryEventIds: string[]; attendanceFrom: string; attendanceTo: string },
  emps: Pick<Employee, 'id' | 'name' | 'state' | 'type' | 'dept'>[],
  events: SalaryEvent[],
  attendance: AttendanceDay[],
  mode: PayslipMode = 'asPaid',
) {
  const ids = new Set(run.salaryEventIds);
  const usable = events.filter((e) => ids.has(e.id));
  const byEmp = new Map<string, SalaryEvent[]>();
  for (const e of usable) byEmp.set(e.employeeId, [...(byEmp.get(e.employeeId) ?? []), e]);
  const att = attendance.filter((a) => a.date >= run.attendanceFrom && a.date <= run.attendanceTo);
  return run.employeeIds.map((id) => {
    const emp = emps.find((x) => x.id === id)!;
    const lop = lopDays(att.filter((a) => a.employeeId === id), run.month);
    const slip = payslip(emp, byEmp.get(id) ?? [], run.month, mode, lop);
    const pick = (k: string) => slip.deductions.find((d) => d.key === k)?.amount ?? 0;
    const esi = slip.gross <= 21000 ? Math.round(slip.gross * 0.0075) : 0;
    return { employeeId: id, name: emp?.name ?? id, dept: emp?.dept, slip, lop, pf: pick('pf'), esi, pt: pick('pt'), tds: pick('tds'), net: slip.net - esi };
  });
}
export function runTotals(lines: ReturnType<typeof runLines>) {
  const s = (f: (l: (typeof lines)[number]) => number) => lines.reduce((a, l) => a + f(l), 0);
  return { employees: lines.length, gross: s((l) => l.slip.gross), pf: s((l) => l.pf), esi: s((l) => l.esi), pt: s((l) => l.pt), tds: s((l) => l.tds), deductions: s((l) => l.slip.totalDeductions + l.esi), net: s((l) => l.net), lopDays: s((l) => l.lop) };
}

/**
 * Form 16 Part B for a financial year: months before today's use the payslip as paid at the time,
 * the rest are projected at the current salary. Everything past today is an estimate.
 */
export function form16Projection(emp: Pick<Employee, 'state' | 'type'>, events: SalaryEvent[], today: string, fyStart = '2026-04-01', fyEnd = '2027-03-31') {
  const months = monthsBetween(fyStart, fyEnd);
  // The current month's run hasn't been paid yet; only earlier months count as paid.
  const paidMonths = months.filter((m) => m < today.slice(0, 7));
  const slips = months.map((m) => payslip(emp, events, m, paidMonths.includes(m) ? 'asPaid' : 'corrected'));
  const sum = (key: string, n = slips.length) => slips.slice(0, n).reduce((a, s) => a + (s.deductions.find((d) => d.key === key)?.amount ?? 0), 0);
  const gross = slips.reduce((a, s) => a + s.gross, 0);
  return {
    months: months.length, actual: paidMonths.length, gross, standardDeduction: 75000,
    taxable: Math.max(0, gross - 75000), tax: Math.round(annualTax(gross)), tdsSoFar: sum('tds', paidMonths.length), pf: sum('pf'),
    final: today > fyEnd,
  };
}
