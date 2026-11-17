import type { AttendanceDay, Employee, LeaveRequest, LeaveType, LeaveTypeCode } from '../types';

export const FY_START = '2026-04-01';
export const FY_END = '2027-03-31';

const monthsInFyBy = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return (y - 2026) * 12 + m - 4 + 1;
};

/**
 * Balance for one leave type in FY 2026–27 as of a date.
 * CL accrues 1/month; EL 1.5/month after probation; SL credited in full in April; CO as earned (2).
 */
export function leaveBalance(emp: Pick<Employee, 'joined' | 'type' | 'status'>, type: LeaveType, requests: LeaveRequest[], asOf: string) {
  const startFy = emp.joined > FY_START ? emp.joined : FY_START;
  const months = Math.max(0, monthsInFyBy(asOf) - (monthsInFyBy(startFy) - 1));
  let entitled = 0;
  if (type.code === 'CL') entitled = Math.min(12, months);
  else if (type.code === 'EL') entitled = emp.type === 'Full-time' && emp.status !== 'Probation' ? Math.min(18, months * 1.5) : 0;
  else if (type.code === 'SL') entitled = 10;
  else if (type.code === 'CO') entitled = 2;
  else return null;
  const taken = requests.filter((r) => r.type === type.code && r.status === 'Approved' && r.from >= FY_START && r.from <= FY_END).reduce((a, r) => a + r.days, 0);
  const pending = requests.filter((r) => r.type === type.code && r.status === 'Pending').reduce((a, r) => a + r.days, 0);
  const annual = type.code === 'EL' ? 18 : type.code === 'CL' ? 12 : type.code === 'SL' ? 10 : 2;
  return { code: type.code as LeaveTypeCode, name: type.name, entitled, taken, pending, available: Math.max(0, entitled - taken), annual };
}

export function leaveBalances(emp: Pick<Employee, 'joined' | 'type' | 'status'>, types: LeaveType[], requests: LeaveRequest[], asOf: string) {
  return types.map((t) => leaveBalance(emp, t, requests, asOf)).filter((x): x is NonNullable<typeof x> => !!x);
}

export const isPresent = (a: AttendanceDay) => a.mark === 'P' || a.mark === 'Late' || a.mark === 'WFH' || a.mark === 'Half day';
export const isScheduled = (a: AttendanceDay) => a.mark !== 'Weekend' && a.mark !== 'Holiday';

export function attendanceSummary(days: AttendanceDay[]) {
  const c = (m: AttendanceDay['mark']) => days.filter((d) => d.mark === m).length;
  return { present: c('P') + c('WFH'), late: c('Late'), leave: c('Leave'), halfDay: c('Half day'), absent: c('Absent'), holidays: c('Holiday'), wfh: c('WFH'), workdays: days.filter(isScheduled).length };
}

/** Org-chart tree from manager links. */
export type OrgNode = { emp: Employee; reports: OrgNode[]; size: number };
export function orgTree(emps: Employee[]): OrgNode[] {
  const by = new Map<string | null, Employee[]>();
  for (const e of emps) by.set(e.managerId, [...(by.get(e.managerId) ?? []), e]);
  const build = (e: Employee): OrgNode => {
    const reports = (by.get(e.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)).map(build);
    return { emp: e, reports, size: 1 + reports.reduce((a, r) => a + r.size, 0) };
  };
  return (by.get(null) ?? []).map(build);
}

export function directReports(emps: Employee[], managerId: string) {
  return emps.filter((e) => e.managerId === managerId);
}
/** Everyone under a manager, any depth. */
export function teamOf(emps: Employee[], managerId: string): Employee[] {
  const out: Employee[] = [];
  const walk = (id: string) => emps.filter((e) => e.managerId === id).forEach((e) => (out.push(e), walk(e.id)));
  walk(managerId);
  return out;
}

/** Working days in a span: weekdays that are not public holidays. What a leave request deducts. */
export function workingDays(from: string, to: string, holidays: { date: string }[]): number {
  if (!from || !to || to < from) return 0;
  const hol = new Set(holidays.map((h) => h.date));
  let n = 0;
  for (let d = new Date(from + 'T00:00:00'); ; d.setDate(d.getDate() + 1)) {
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (iso > to) break;
    if (d.getDay() !== 0 && d.getDay() !== 6 && !hol.has(iso)) n++;
  }
  return n;
}
