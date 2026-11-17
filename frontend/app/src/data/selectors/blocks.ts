/**
 * Block analytics from real records: a GitHub-style daily grid, waffle, pixel bars and block meters.
 * Manager views are team aggregates only — never one named person's days.
 */
import { addDays, addMonths, dayOfWeek, mondayOf, parseDate } from '../../lib/dates';
import { MON, ddm, hours, lakh } from '../../lib/format';
import type { Approval, AttendanceDay, Budget, Employee, ExpenseClaim, Invoice, LeaveRequest, LeaveType, OnboardingCase, Project, Role, SalaryEvent, Task, TimesheetEntry } from '../types';
import { isSpent, revenueIssuedIn } from './finance';
import { makeCostRates } from './payroll';
import { isPresent, leaveBalances, teamOf } from './people';

export type BlockColour = 'Violet' | 'Ember' | 'Mono';
// Ramps for a light card, lightest to darkest. The stored keys are kept for saved settings; 'Violet' now reads as
// olive (the default), 'Ember' as the signal orange, 'Mono' as warm greys.
const RAMPS: Record<BlockColour, string[]> = {
  Violet: ['#D9E0CC', '#B4C29F', '#8DA172', '#6A8150', '#4C5F39', '#2F3A24'],
  Ember: ['#F8D3C3', '#F2A98B', '#EB7E55', '#D9562B', '#AE3E1B', '#722812'],
  Mono: ['#DCDED4', '#B9BCAF', '#93978A', '#6E7266', '#4C4F46', '#2B2E27'],
};
export const EMPTY = '#ECEDE5';
const DIM = '#C9CCC0';
const AMBER = '#C58B1C';
const RED = '#B4232F';
/** The utilisation target line's cell colour (read by the client to place the dashed target). */
export const TARGET = 'rgba(197,139,28,0.5)';
export const RANGES = [13, 26, 52] as const;
export type Range = (typeof RANGES)[number];

export type Cell = { colour: string; title?: string };
export type HeatDay = { title: string; bg: string; future: boolean; today: boolean };
export type Legend = { colour: string; label: string; value?: string };
export type BlockModel = {
  title: string;
  metricIndex: number;
  metricLabels: string[];
  stats: { value: string; label: string }[];
  weeks: { month: string; days: HeatDay[] }[];
  levels: string[];
  waffle: { title: string; sub: string; cols: number; cells: Cell[]; legend: Legend[] };
  meters: { title: string; sub: string; rows: { label: string; value: string; cells: Cell[] }[] };
  pixels: null | { title: string; sub: string; unit: string; legend: Legend[]; groups: { label: string; value: string; cols: Cell[][] }[] };
};

export type BlocksInput = {
  role: Role; today: string; meId: string;
  employees: Employee[]; entries: TimesheetEntry[]; attendance: AttendanceDay[]; leave: LeaveRequest[]; leaveTypes: LeaveType[];
  approvals: Approval[]; projects: Project[]; clients: { id: string; name: string }[]; tasks: Task[]; invoices: Invoice[];
  expenses: ExpenseClaim[]; salaryEvents: SalaryEvent[]; budgets: Budget[]; onboarding: OnboardingCase[];
};

type Metric = { label: string; unit: 'h' | '%' | 'people' | 'count'; day: (d: string) => number | null; say: (v: number) => string; averaged: boolean };

const groupBy = <T,>(xs: T[], k: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(k(x), [...(m.get(k(x)) ?? []), x]);
  return m;
};

export function buildBlocks(x: BlocksInput, metricIdx: number, range: Range, accent: BlockColour): BlockModel {
  const SEG = RAMPS[accent];
  const LEVELS = [EMPTY, SEG[0], SEG[1], SEG[2], SEG[4]];
  const t = x.today;
  const team = new Set(teamOf(x.employees, x.meId).map((e) => e.id));
  const entriesBy = groupBy(x.entries, (e) => e.date);
  const attBy = groupBy(x.attendance, (a) => a.date);
  const sum = (es: TimesheetEntry[] | undefined, f: (e: TimesheetEntry) => boolean = () => true) => (es ?? []).filter(f).reduce((a, e) => a + e.hours, 0);
  const r1 = (v: number) => Math.round(v * 10) / 10;

  const metrics: Metric[] = (() => {
    switch (x.role) {
      case 'Admin':
        return [
          { label: 'Hours logged', unit: 'h', day: (d) => r1(sum(entriesBy.get(d))), say: (v) => hours(v) + ' logged', averaged: false },
          { label: 'Billable share', unit: '%', day: (d) => { const all = sum(entriesBy.get(d)); return all ? Math.round((sum(entriesBy.get(d), (e) => e.billable) / all) * 100) : null; }, say: (v) => v + '% billable', averaged: true },
          { label: 'Attendance', unit: 'people', day: (d) => { const a = attBy.get(d); return a && a.some((y) => y.mark !== 'Weekend' && y.mark !== 'Holiday') ? a.filter(isPresent).length : null; }, say: (v) => v + ' present', averaged: true },
        ];
      case 'HR':
        return [
          { label: 'Attendance', unit: 'people', day: (d) => { const a = attBy.get(d); return a && a.some((y) => y.mark !== 'Weekend' && y.mark !== 'Holiday') ? a.filter(isPresent).length : null; }, say: (v) => v + ' present', averaged: true },
          { label: 'On leave', unit: 'people', day: (d) => (attBy.get(d) ?? []).filter((a) => a.mark === 'Leave').length, say: (v) => v + ' on leave', averaged: false },
          { label: 'Late marks', unit: 'count', day: (d) => (attBy.get(d) ?? []).filter((a) => a.mark === 'Late').length, say: (v) => v + ' late marks', averaged: false },
        ];
      case 'Manager':
        return [
          { label: 'Team hours', unit: 'h', day: (d) => r1(sum(entriesBy.get(d), (e) => team.has(e.employeeId))), say: (v) => hours(v) + ' across the team', averaged: false },
          { label: 'Approvals cleared', unit: 'count', day: (d) => x.approvals.filter((a) => a.chain.some((s) => s.approverId === x.meId && s.decision && s.at?.slice(0, 10) === d)).length, say: (v) => v + ' approvals cleared', averaged: false },
        ];
      default:
        return [
          { label: 'Your hours', unit: 'h', day: (d) => r1(sum(entriesBy.get(d), (e) => e.employeeId === x.meId)), say: (v) => hours(v) + ' logged', averaged: false },
          { label: 'Billable hours', unit: 'h', day: (d) => r1(sum(entriesBy.get(d), (e) => e.employeeId === x.meId && e.billable)), say: (v) => hours(v) + ' billable', averaged: false },
        ];
    }
  })();
  const mi = Math.min(metricIdx, metrics.length - 1);
  const m = metrics[mi];
  const fmt = (v: number) => (m.unit === 'h' ? hours(v) : m.unit === '%' ? Math.round(v) + '%' : Math.round(v).toLocaleString('en-IN'));

  const lastMonday = mondayOf(t);
  const firstMonday = addDays(lastMonday, -7 * (range - 1));
  const values: { d: string; v: number | null }[] = [];
  for (let i = 0; i < range * 7; i++) {
    const d = addDays(firstMonday, i);
    values.push({ d, v: d > t ? null : m.day(d) });
  }
  const max = Math.max(1, ...values.map((y) => y.v ?? 0));
  const min = m.averaged ? Math.min(...values.filter((y) => y.v && dayOfWeek(y.d) % 6).map((y) => y.v as number)) : 0;
  const level = (v: number) => (v <= 0 ? 0 : 1 + Math.min(3, Math.floor(((v - (m.averaged ? min * 0.98 : 0)) / (max - (m.averaged ? min * 0.98 : 0) || 1)) * 4)));
  const weeks: BlockModel['weeks'] = [];
  for (let w = 0; w < range; w++) {
    const m0 = addDays(firstMonday, w * 7);
    const prevM0 = addDays(m0, -7);
    const mo = parseDate(m0).getMonth();
    let month = '';
    if (w === 0) { if (parseDate(addDays(m0, 14)).getMonth() === mo) month = MON[mo]; }
    else if (parseDate(prevM0).getMonth() !== mo) month = MON[mo];
    weeks.push({
      month,
      days: values.slice(w * 7, w * 7 + 7).map(({ d, v }) => {
        const future = d > t;
        return { title: ddm(d) + ' · ' + (future ? 'upcoming' : v === null ? 'no record' : v === 0 ? 'none' : m.say(v)), bg: future ? 'transparent' : v === null ? EMPTY : LEVELS[level(v)], future, today: d === t };
      }),
    });
  }
  const weekdays = values.filter((y) => y.v !== null && dayOfWeek(y.d) % 6 !== 0);
  const thisWeek = values.filter((y) => y.d >= lastMonday && y.v !== null);
  const peak = values.reduce((b, y) => ((y.v ?? -1) > (b.v ?? -1) ? y : b), values[0]);
  const stats = [
    { value: fmt(m.averaged ? thisWeek.filter((y) => dayOfWeek(y.d) % 6).reduce((a, y) => a + (y.v ?? 0), 0) / Math.max(1, thisWeek.filter((y) => dayOfWeek(y.d) % 6).length) : thisWeek.reduce((a, y) => a + (y.v ?? 0), 0)), label: m.averaged ? 'This week, daily average' : 'This week so far' },
    { value: fmt(weekdays.reduce((a, y) => a + (y.v ?? 0), 0) / Math.max(1, weekdays.length)), label: 'Weekday average, ' + range + ' weeks' },
    { value: fmt(peak.v ?? 0), label: 'Peak · ' + parseDate(peak.d).getDate() + ' ' + MON[parseDate(peak.d).getMonth()] },
  ];

  // ---- waffle ----
  type Seg = [string, number, string, boolean?];
  let wf: { title: string; sub: string; cols: number; segs: Seg[]; rest: number };
  const wk = x.entries.filter((e) => e.date >= lastMonday && e.date <= t);
  if (x.role === 'Admin') {
    const total = sum(wk);
    const byC = [...groupBy(wk, (e) => e.clientId)].map(([c, es]) => [c, sum(es)] as const).sort((a, b) => b[1] - a[1]);
    const pcts = byC.map(([c, h]) => [x.clients.find((y) => y.id === c)?.name ?? c, total ? Math.round((h / total) * 100) : 0] as const);
    const drift = 100 - pcts.reduce((a, p) => a + p[1], 0);
    if (pcts.length) pcts[0] = [pcts[0][0], pcts[0][1] + drift];
    wf = { title: 'Where this week went', sub: hours(total) + ' in total', cols: 20, rest: 0, segs: pcts.map(([n, p]) => [n, p, p + '%']) };
  } else if (x.role === 'HR') {
    const active = x.employees.filter((e) => e.status !== 'Inactive');
    const byD = [...groupBy(active, (e) => e.dept)].sort((a, b) => b[1].length - a[1].length);
    wf = { title: 'Headcount by department', sub: active.length + ' people', cols: 15, rest: 0, segs: byD.map(([d, es], i) => [d, es.length, String(es.length), i === byD.length - 1]) };
  } else if (x.role === 'Manager') {
    const tw = wk.filter((e) => team.has(e.employeeId));
    const total = sum(tw);
    const byP = [...groupBy(tw, (e) => e.projectId)].map(([p, es]) => [x.projects.find((y) => y.id === p)?.name ?? p, sum(es)] as const).sort((a, b) => b[1] - a[1]);
    wf = { title: 'Team hours this week', sub: hours(total) + ' in total', cols: 15, rest: 0, segs: byP.map(([n, h]) => [n, Math.round(h / 2), hours(h)]) };
  } else {
    const mine = x.entries.filter((e) => e.employeeId === x.meId && e.date >= lastMonday && e.date <= addDays(lastMonday, 6));
    const byT = [...groupBy(mine, (e) => e.note + (e.billable ? '' : ' ·'))].map(([, es]) => [es[0].note, sum(es), !es[0].billable] as const);
    const total = sum(mine);
    wf = { title: 'Your week so far', sub: hours(total) + ' of 40 h', cols: 16, rest: Math.max(0, 80 - Math.round(total * 2)), segs: byT.map(([n, h, nb]) => [n, Math.round(h * 2), hours(h), nb]) };
  }
  let ci = 0;
  const cells: Cell[] = [];
  const legend: Legend[] = [];
  for (const [k, n, v, muted] of wf.segs) {
    const colour = muted ? DIM : SEG[Math.max(5 - ci++, 0)];
    for (let i = 0; i < n; i++) cells.push({ colour, title: k + ' · ' + v });
    legend.push({ colour, label: k, value: v });
  }
  for (let i = 0; i < wf.rest; i++) cells.push({ colour: EMPTY, title: 'Not logged yet' });

  // ---- meters ----
  const cellsOf = (n: number, filled: number, colour: string): Cell[] => Array.from({ length: n }, (_, i) => ({ colour: i < Math.floor(filled) ? colour : i < filled ? SEG[4] : EMPTY }));
  let meters: BlockModel['meters'];
  if (x.role === 'Admin') {
    const empDept = new Map(x.employees.map((e) => [e.id, e.dept]));
    meters = { title: 'Budget used', sub: 'FY 2026–27 · committed plus approved spend', rows: x.budgets.map((b) => {
      const spent = x.expenses.filter((e) => isSpent(e) && empDept.get(e.employeeId) === b.dept && e.date >= '2026-04-01').reduce((a, e) => a + e.amount, 0);
      const p = Math.round(((b.committed + spent) / b.planned) * 100);
      return { label: b.dept, value: p > 100 ? p + '% · over' : p >= 90 ? p + '% · near' : p + '%', p, cells: cellsOf(20, Math.round(Math.min(p, 100) / 5), p > 100 ? RED : SEG[2]) };
    }).sort((a, b) => b.p - a.p) };
  } else if (x.role === 'Manager') {
    meters = { title: 'Project progress', sub: 'Tasks done of total', rows: x.projects.filter((p) => p.status === 'Active').map((p) => {
      const ts = x.tasks.filter((k) => k.projectId === p.id);
      const pc = ts.length ? Math.round((ts.filter((k) => k.status === 'done').length / ts.length) * 100) : 0;
      return { label: p.name, value: pc + '%', cells: cellsOf(20, Math.round(pc / 5), SEG[2]) };
    }) };
  } else if (x.role === 'HR') {
    meters = { title: 'Onboarding checklists', sub: 'Checklist items done', rows: x.onboarding.filter((o) => o.kind === 'Joining').map((o) => {
      const done = o.items.filter((i) => i.done).length;
      return { label: o.personName, value: done + ' of ' + o.items.length, cells: cellsOf(o.items.length, done, SEG[2]) };
    }) };
  } else {
    const me = x.employees.find((e) => e.id === x.meId)!;
    const bal = leaveBalances(me, x.leaveTypes, x.leave.filter((l) => l.employeeId === x.meId), t);
    meters = { title: 'Leave remaining', sub: 'Days left of this year’s entitlement', rows: bal.map((b) => ({ label: b.name, value: b.available + ' of ' + b.annual, cells: cellsOf(b.annual, b.available, SEG[2]) })) };
  }

  // ---- pixel bars ----
  let pixels: BlockModel['pixels'] = null;
  if (x.role === 'Admin') {
    const rate = makeCostRates(x.salaryEvents);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(t.slice(0, 7), i - 5));
    const groups = months.map((mo) => {
      const rev = revenueIssuedIn(x.invoices, mo) / 1e5;
      const cost = x.entries.filter((e) => e.date.startsWith(mo)).reduce((a, e) => a + e.hours * rate(e.employeeId, e.date), 0) / 1e5;
      return { mo, vals: [rev, cost] };
    });
    const u = 4;
    const max = Math.max(...groups.flatMap((g) => g.vals), 8);
    const rows = Math.ceil(max / u);
    pixels = {
      title: 'Revenue vs labour cost', sub: 'Invoiced in month vs estimated labour cost, ₹ lakh', unit: 'Dark bars are invoiced revenue; light bars are labour cost (estimated).',
      legend: [{ colour: SEG[4], label: 'Revenue' }, { colour: SEG[1], label: 'Labour cost' }],
      groups: groups.map((g) => ({ label: MON[+g.mo.slice(5) - 1], value: lakh(g.vals[0] * 1e5), cols: g.vals.map((v, si) => { const n = Math.round(v / u); return Array.from({ length: rows }, (_, i) => ({ colour: i >= rows - n ? (si ? SEG[1] : SEG[4]) : EMPTY })); }) })),
    };
  } else if (x.role === 'Manager') {
    const target = 75;
    const weeksBack = Array.from({ length: 8 }, (_, i) => addDays(lastMonday, -7 * (8 - i)));
    const rows = 20;
    const tr = rows - Math.round(target / 5);
    pixels = {
      title: 'Team utilisation', sub: 'Billable hours ÷ 40 h capacity per person, last eight full weeks', unit: 'The dashed amber line marks the 75% target.',
      legend: [{ colour: SEG[3], label: 'Utilisation' }, { colour: AMBER, label: 'Target 75%' }],
      groups: weeksBack.map((w) => {
        const es = x.entries.filter((e) => team.has(e.employeeId) && e.date >= w && e.date <= addDays(w, 6));
        const heads = new Set(es.map((e) => e.employeeId)).size;
        const pc = heads ? Math.round((sum(es, (e) => e.billable) / (heads * 40)) * 100) : 0;
        const n = Math.round(Math.min(pc, 100) / 5);
        const wn = 'W' + Math.ceil((parseDate(w).getTime() - new Date(parseDate(w).getFullYear(), 0, 1).getTime()) / 864e5 / 7 + 1);
        return { label: wn, value: pc + '%', cols: [Array.from({ length: rows }, (_, i) => ({ colour: i >= rows - n ? SEG[3] : i === tr ? TARGET : EMPTY }))] };
      }),
    };
  }

  return { title: m.label + ' · last ' + range + ' weeks', metricIndex: mi, metricLabels: metrics.map((y) => y.label), stats, weeks, levels: LEVELS, waffle: { ...wf, cells, legend }, meters, pixels };
}
