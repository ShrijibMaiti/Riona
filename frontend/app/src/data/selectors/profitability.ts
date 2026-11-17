import type { Client, Employee, ExpenseClaim, Invoice, Project, SalaryEvent, TimesheetEntry } from '../types';
import { isSpent } from './finance';
import { makeCostRates } from './payroll';

/**
 * Margin, traced to hours. For any client or project:
 *   revenue    = Σ invoice line amounts (pre-tax, non-void invoices)
 *   labourCost = Σ entry hours × cost rate (cost rate is estimated from CTC)
 *   expenses   = Σ approved/reimbursed claims tagged to it
 *   margin     = revenue − labourCost − expenses
 */
export type Figures = { revenue: number; labour: number; expenses: number; margin: number; pct: number; hours: number; billableHours: number };
export type PersonRow = Figures & { employeeId: string; key: string };
export type ProjectRow = Figures & { projectId: string; clientId: string; people: PersonRow[]; other: { revenue: number; expenses: number } };
export type ClientRow = Figures & { clientId: string; projects: ProjectRow[]; unassignedRevenue: number };

export type ProfitInput = {
  clients: Client[];
  projects: Project[];
  entries: TimesheetEntry[];
  invoices: Invoice[];
  expenses: ExpenseClaim[];
  salaryEvents: SalaryEvent[];
};

const zero = (): Figures => ({ revenue: 0, labour: 0, expenses: 0, margin: 0, pct: 0, hours: 0, billableHours: 0 });
const settle = <T extends Figures>(f: T): T => {
  f.margin = f.revenue - f.labour - f.expenses;
  f.pct = f.revenue ? (f.margin / f.revenue) * 100 : 0;
  return f;
};

/** Revenue attributed to each entry: its share (by hours) of the invoice lines that reference it. */
export function entryRevenue(invoices: Invoice[], entries: TimesheetEntry[]) {
  const hours = new Map(entries.map((e) => [e.id, e.hours]));
  const out = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === 'Void') continue;
    for (const l of inv.lines) {
      if (!l.entryIds.length) continue;
      const total = l.entryIds.reduce((a, id) => a + (hours.get(id) ?? 0), 0);
      if (!total) continue;
      for (const id of l.entryIds) out.set(id, (out.get(id) ?? 0) + (l.amount * (hours.get(id) ?? 0)) / total);
    }
  }
  return out;
}

/** Entries with their attributed revenue, cost and margin — the rows every profitability figure traces to. */
export function costedEntries(input: Pick<ProfitInput, 'entries' | 'invoices' | 'salaryEvents'>) {
  const rate = makeCostRates(input.salaryEvents);
  const rev = entryRevenue(input.invoices, input.entries);
  return input.entries.map((e) => {
    const cost = e.hours * rate(e.employeeId, e.date);
    const revenue = rev.get(e.id) ?? 0;
    return { entry: e, costRate: rate(e.employeeId, e.date), cost, revenue, margin: revenue - cost, invoiced: rev.has(e.id) };
  });
}

export function profitability(input: ProfitInput) {
  const rows = costedEntries(input);
  const proj = new Map<string, ProjectRow>();
  for (const p of input.projects) proj.set(p.id, { ...zero(), projectId: p.id, clientId: p.clientId, people: [], other: { revenue: 0, expenses: 0 } });
  const people = new Map<string, PersonRow>();
  const unassigned = new Map<string, number>();

  // Revenue: every line counts once, at its project (or the client if it has none).
  for (const inv of input.invoices) {
    if (inv.status === 'Void') continue;
    for (const l of inv.lines) {
      const pr = l.projectId ? proj.get(l.projectId) : undefined;
      if (pr) {
        pr.revenue += l.amount;
        if (!l.entryIds.length) pr.other.revenue += l.amount;
      } else unassigned.set(inv.clientId, (unassigned.get(inv.clientId) ?? 0) + l.amount);
    }
  }
  // Labour and attributed person revenue.
  for (const r of rows) {
    const pr = proj.get(r.entry.projectId);
    if (!pr) continue;
    pr.labour += r.cost;
    pr.hours += r.entry.hours;
    if (r.entry.billable) pr.billableHours += r.entry.hours;
    const k = pr.projectId + '|' + r.entry.employeeId;
    let pp = people.get(k);
    if (!pp) {
      pp = { ...zero(), employeeId: r.entry.employeeId, key: k };
      people.set(k, pp);
      pr.people.push(pp);
    }
    pp.revenue += r.revenue;
    pp.labour += r.cost;
    pp.hours += r.entry.hours;
    if (r.entry.billable) pp.billableHours += r.entry.hours;
  }
  // Expenses at project level.
  for (const x of input.expenses) {
    if (!isSpent(x) || !x.projectId) continue;
    const pr = proj.get(x.projectId);
    if (pr) {
      pr.expenses += x.amount;
      pr.other.expenses += x.amount;
    }
  }
  for (const pr of proj.values()) {
    pr.people.forEach(settle);
    pr.people.sort((a, b) => a.margin - b.margin);
    settle(pr);
  }
  // Client-tagged expenses without a project.
  const clientOnlyExp = new Map<string, number>();
  for (const x of input.expenses) if (isSpent(x) && x.clientId && !x.projectId) clientOnlyExp.set(x.clientId, (clientOnlyExp.get(x.clientId) ?? 0) + x.amount);

  const clients: ClientRow[] = input.clients.map((c) => {
    const ps = [...proj.values()].filter((p) => p.clientId === c.id).sort((a, b) => a.margin - b.margin);
    const f = zero();
    for (const p of ps) {
      f.revenue += p.revenue;
      f.labour += p.labour;
      f.expenses += p.expenses;
      f.hours += p.hours;
      f.billableHours += p.billableHours;
    }
    const un = unassigned.get(c.id) ?? 0;
    f.revenue += un;
    f.expenses += clientOnlyExp.get(c.id) ?? 0;
    return settle({ ...f, clientId: c.id, projects: ps, unassignedRevenue: un });
  }).sort((a, b) => a.margin - b.margin);

  // By employee across everything.
  const emp = new Map<string, PersonRow>();
  for (const r of rows) {
    let e = emp.get(r.entry.employeeId);
    if (!e) {
      e = { ...zero(), employeeId: r.entry.employeeId, key: r.entry.employeeId };
      emp.set(r.entry.employeeId, e);
    }
    e.revenue += r.revenue;
    e.labour += r.cost;
    e.hours += r.entry.hours;
    if (r.entry.billable) e.billableHours += r.entry.hours;
  }
  const employees = [...emp.values()].map(settle).sort((a, b) => a.margin - b.margin);
  const projects = [...proj.values()].sort((a, b) => a.margin - b.margin);
  const total = settle(clients.reduce((t, c) => ({ ...t, revenue: t.revenue + c.revenue, labour: t.labour + c.labour, expenses: t.expenses + c.expenses, hours: t.hours + c.hours, billableHours: t.billableHours + c.billableHours }), zero()));
  return { clients, projects, employees, total };
}

export type Profitability = ReturnType<typeof profitability>;
export const personName = (emps: Employee[], id: string) => emps.find((e) => e.id === id)?.name ?? id;

export type Period = { key: string; label: string; from: string; to: string };
export const PERIODS: Period[] = [
  { key: 'all', label: 'May – Nov 2026', from: '2026-05-01', to: '2026-11-30' },
  { key: 'q3', label: 'This quarter · Oct – Dec', from: '2026-10-01', to: '2026-12-31' },
  { key: 'q2', label: 'Last quarter · Jul – Sep', from: '2026-07-01', to: '2026-09-30' },
];
/** Limit inputs to a period: invoices by issue date, entries and expenses by date. */
export function inPeriod(input: ProfitInput, p: Period): ProfitInput {
  return {
    ...input,
    invoices: input.invoices.filter((i) => i.issued >= p.from && i.issued <= p.to),
    entries: input.entries.filter((e) => e.date >= p.from && e.date <= p.to),
    expenses: input.expenses.filter((x) => x.date >= p.from && x.date <= p.to),
  };
}

export type Scope = { clientId?: string; projectId?: string; employeeId?: string };
/**
 * The records behind a figure: every entry with its attributed revenue and cost, plus the revenue and expenses
 * that are not tied to hours. Σ entry margin + otherRevenue − expenses = the margin shown for the same scope.
 */
export function drill(input: ProfitInput, scope: Scope) {
  const rows = costedEntries(input).filter(
    (r) => (!scope.clientId || r.entry.clientId === scope.clientId) && (!scope.projectId || r.entry.projectId === scope.projectId) && (!scope.employeeId || r.entry.employeeId === scope.employeeId),
  );
  // Revenue not attributable to entries (expense rebills, milestones with no hours, manual lines) — only when not scoped to a person.
  const other: { label: string; amount: number; ref: string }[] = [];
  if (!scope.employeeId) {
    for (const inv of input.invoices) {
      if (inv.status === 'Void' || (scope.clientId && inv.clientId !== scope.clientId)) continue;
      for (const l of inv.lines) {
        if (l.entryIds.length) continue;
        if (scope.projectId && l.projectId !== scope.projectId) continue;
        other.push({ label: l.description, amount: l.amount, ref: inv.number });
      }
    }
  }
  const expenses = scope.employeeId ? [] : input.expenses.filter((x) => isSpent(x) && (scope.projectId ? x.projectId === scope.projectId : scope.clientId ? x.clientId === scope.clientId : !!x.clientId));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const revenue = sum((r) => r.revenue) + other.reduce((a, o) => a + o.amount, 0);
  const labour = sum((r) => r.cost);
  const exp = expenses.reduce((a, x) => a + x.amount, 0);
  return { rows, other, expenses, totals: { hours: sum((r) => r.entry.hours), entryRevenue: sum((r) => r.revenue), revenue, labour, expenses: exp, margin: revenue - labour - exp } };
}
