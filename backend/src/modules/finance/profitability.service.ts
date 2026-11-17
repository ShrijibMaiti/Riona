/**
 * Profitability, traced to hours (Admin only: cost rates derive from salaries). For any client or project:
 *   revenue    = Σ invoice line amounts (pre-tax, non-void invoices)
 *   labour     = Σ entry hours × cost rate (from the entry_costs view, db/views/profitability.sql; estimated)
 *   expenses   = Σ approved or reimbursed claims tagged to it
 *   margin     = revenue − labour − expenses
 * The same calculation as the frontend (selectors/profitability.ts), over the same records in the same order, so
 * the two agree to the rupee; test/invariants/reconciliation.test.ts checks it. Every figure drills down to the
 * entry ids behind it (/profitability/entries).
 */
import type { ExpenseClaim, Invoice, TimesheetEntry } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { unprocessable } from '../../lib/errors';
import { F, opt } from '../../lib/validate';
import { toEntry } from '../work/timesheets.service';
import { loadInvoices } from './invoices.repo';
import { listExpenses } from './expenses.service';

export type Figures = { revenue: number; labour: number; expenses: number; margin: number; pct: number; hours: number; billableHours: number };
export type PersonRow = Figures & { employeeId: string; key: string };
export type ProjectRow = Figures & { projectId: string; clientId: string; people: PersonRow[]; other: { revenue: number; expenses: number } };
export type ClientRow = Figures & { clientId: string; projects: ProjectRow[]; unassignedRevenue: number };

/** The periods the Profitability screen offers (frontend selectors/profitability.ts PERIODS). */
export const PERIODS: Record<string, { from: string; to: string }> = {
  all: { from: '2026-05-01', to: '2026-11-30' },
  q3: { from: '2026-10-01', to: '2026-12-31' },
  q2: { from: '2026-07-01', to: '2026-09-30' },
};

/** ?period=all|q3|q2, or ?from&to; no period means everything. */
export const PeriodQuery = z.object({ period: opt(z.string().max(10)), from: opt(F.date), to: opt(F.date) });
export const DrillQuery = PeriodQuery.extend({ clientId: opt(z.string().max(40)), projectId: opt(z.string().max(40)), employeeId: opt(z.string().max(40)) });

type Input = {
  clients: { id: string }[];
  projects: { id: string; clientId: string }[];
  entries: (TimesheetEntry & { costRate: number })[];
  invoices: Invoice[];
  expenses: ExpenseClaim[];
};

const isSpent = (x: ExpenseClaim) => x.status === 'Approved' || x.status === 'Reimbursed';
const zero = (): Figures => ({ revenue: 0, labour: 0, expenses: 0, margin: 0, pct: 0, hours: 0, billableHours: 0 });
const settle = <T extends Figures>(f: T): T => {
  f.margin = f.revenue - f.labour - f.expenses;
  f.pct = f.revenue ? (f.margin / f.revenue) * 100 : 0;
  return f;
};

/** The records, limited to a period: invoices by issue date, entries and claims by date. */
async function inputs(actor: Actor, q: z.infer<typeof PeriodQuery>): Promise<Input> {
  authorize(actor, 'finance', 'approve');
  const p = q.period ? PERIODS[q.period] : q.from || q.to ? { from: q.from ?? '0000-01-01', to: q.to ?? '9999-12-31' } : null;
  if (q.period && !p) throw unprocessable('Choose a period: all, q3 or q2.', { period: 'Unknown' });
  const [clients, projects, rows, invoices, expenses] = await Promise.all([
    db.selectFrom('clients').select('id').orderBy('name').execute(),
    db.selectFrom('projects').select(['id', 'clientId']).orderBy('start').orderBy('id').execute(),
    db.selectFrom('timesheetEntries as e').innerJoin('entryCosts as c', 'c.entryId', 'e.id').selectAll('e').select('c.costRate').orderBy('e.date').orderBy('e.id').execute(),
    loadInvoices(db),
    listExpenses(actor, {}).then((r) => r.items),
  ]);
  const inP = (d: string) => !p || (d >= p.from && d <= p.to);
  return {
    clients, projects,
    entries: rows.filter((r) => inP(r.date)).map((r) => ({ ...toEntry(r), costRate: r.costRate ?? 0 })),
    invoices: invoices.filter((i) => inP(i.issued)),
    expenses: expenses.filter((x) => inP(x.date)),
  };
}

/** Revenue attributed to each entry: its share (by hours) of the invoice lines that reference it. */
function entryRevenue(invoices: Invoice[], entries: TimesheetEntry[]) {
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

/** Each entry with its attributed revenue, cost and margin: the rows every figure traces to. */
function costed(input: Input) {
  const rev = entryRevenue(input.invoices, input.entries);
  return input.entries.map(({ costRate, ...e }) => {
    const cost = e.hours * costRate;
    const revenue = rev.get(e.id) ?? 0;
    return { entry: e, costRate, cost, revenue, margin: revenue - cost, invoiced: rev.has(e.id) };
  });
}

function compute(input: Input) {
  const rows = costed(input);
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

/** GET /profitability?period — margin by client, project (with people) and employee, and the total. */
export async function getProfitability(actor: Actor, q: z.infer<typeof PeriodQuery>) {
  return compute(await inputs(actor, q));
}

/**
 * GET /profitability/entries?period&clientId&projectId&employeeId — the records behind a figure: every entry with
 * its attributed revenue and cost, plus revenue and claims not tied to hours.
 * Σ entry margin + other revenue − expenses = the margin shown for the same scope.
 */
export async function getProfitEntries(actor: Actor, q: z.infer<typeof DrillQuery>) {
  const input = await inputs(actor, q);
  const rows = costed(input).filter(
    (r) => (!q.clientId || r.entry.clientId === q.clientId) && (!q.projectId || r.entry.projectId === q.projectId) && (!q.employeeId || r.entry.employeeId === q.employeeId),
  );
  const other: { label: string; amount: number; ref: string }[] = [];
  if (!q.employeeId) {
    for (const inv of input.invoices) {
      if (inv.status === 'Void' || (q.clientId && inv.clientId !== q.clientId)) continue;
      for (const l of inv.lines) {
        if (l.entryIds.length) continue;
        if (q.projectId && l.projectId !== q.projectId) continue;
        other.push({ label: l.description, amount: l.amount, ref: inv.number });
      }
    }
  }
  const expenses = q.employeeId ? [] : input.expenses.filter((x) => isSpent(x) && (q.projectId ? x.projectId === q.projectId : q.clientId ? x.clientId === q.clientId : !!x.clientId));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const revenue = sum((r) => r.revenue) + other.reduce((a, o) => a + o.amount, 0);
  const labour = sum((r) => r.cost);
  const exp = expenses.reduce((a, x) => a + x.amount, 0);
  return { rows, other, expenses, totals: { hours: sum((r) => r.entry.hours), entryRevenue: sum((r) => r.revenue), revenue, labour, expenses: exp, margin: revenue - labour - exp } };
}
