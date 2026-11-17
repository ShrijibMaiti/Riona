/**
 * Wave 6: the reconciliation identity holds on Postgres, and the server's figures equal the frontend's.
 *  - invoices, claims, budgets and finance approvals read exactly as the frontend's fixture has them
 *  - /profitability equals the frontend's selector over the same records, for every period
 *  - revenue = Σ invoice lines (pre-tax, non-void); labour = Σ hours × cost rate; margin = revenue − labour − expenses
 *  - every margin traces to entry ids: the drill-down's rows and other lines add up to the figure shown
 */
import { afterAll, describe, expect, it } from 'vitest';
import { fixture } from '../helpers/golden';
import * as sel from '../../../frontend/app/src/data/selectors/profitability';
import { db } from '../helpers/db';
import { signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const instants = <T,>(x: T): T => JSON.parse(JSON.stringify(x), (k, v) => (k === 'at' && typeof v === 'string' ? Date.parse(v) : v));
/** Deep equality with money compared to a millionth of a rupee (sums of fractional attributions). */
function close(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b), path).toBeLessThan(1e-6);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, path).toBe(b.length);
    a.forEach((x, i) => close(x, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

describe('parity with the frontend fixture (as Admin)', () => {
  it('invoices, with their lines, the hours each bills, payments and revisions', async () => {
    const admin = await signIn('Admin');
    const want = (await fixture.getInvoices()).items;
    const got = (await admin.get('/invoices?pageSize=1000')).body.items.filter((i: { id: string }) => want.some((w) => w.id === i.id));
    expect(instants(byId(got))).toEqual(instants(byId(want)));
    expect((await admin.get('/invoices/' + want[0].id)).body.lines).toEqual(want[0].lines);
  });

  it('expense claims, budgets, and expense and invoice approvals with their sources', async () => {
    const admin = await signIn('Admin');
    const claims = (await fixture.getExpenses()).items;
    const got = (await admin.get('/expenses?pageSize=1000')).body.items.filter((x: { id: string }) => claims.some((c) => c.id === x.id));
    expect(instants(byId(got))).toEqual(instants(byId(claims)));
    expect(byId((await admin.get('/budgets')).body)).toEqual(byId(await fixture.getBudgets()));
    for (const type of ['Expense', 'Invoice'] as const) {
      const want = await fixture.getApprovals({ type });
      const list = (await admin.get('/approvals?type=' + type)).body.filter((a: { id: string }) => want.some((w) => w.id === a.id));
      expect(instants(byId(list)), type).toEqual(instants(byId(want)));
    }
  });
});

/** The frontend's profitability over exactly what the API returns to an Admin. */
async function frontendInput() {
  const admin = await signIn('Admin');
  const [clients, projects, entries, invoices, expenses, salaryEvents] = await Promise.all([
    admin.get('/clients'), admin.get('/projects?pageSize=1000'), admin.get('/timesheet-entries'), admin.get('/invoices?pageSize=1000'),
    admin.get('/expenses?pageSize=1000'), admin.get('/salary-events'),
  ]);
  return { admin, input: { clients: clients.body, projects: projects.body.items, entries: entries.body, invoices: invoices.body.items, expenses: expenses.body.items, salaryEvents: salaryEvents.body } };
}

describe('profitability', () => {
  it('equals the frontend’s calculation, for every period', async () => {
    const { admin, input } = await frontendInput();
    for (const p of sel.PERIODS) {
      const res = await admin.get('/profitability?period=' + p.key);
      expect(res.status, p.key).toBe(200);
      close(res.body, JSON.parse(JSON.stringify(sel.profitability(sel.inPeriod(input, p)))), p.key);
    }
  });

  it('holds the identity: revenue = Σ lines, labour = Σ hours × cost rate, margin = revenue − labour − expenses', async () => {
    const { admin, input } = await frontendInput();
    const p = sel.PERIODS[0];
    const { total } = (await admin.get('/profitability?period=all')).body;
    const inP = sel.inPeriod(input, p);
    const revenue = inP.invoices.filter((i: { status: string }) => i.status !== 'Void').flatMap((i: { lines: { amount: number }[] }) => i.lines).reduce((a: number, l: { amount: number }) => a + l.amount, 0);
    expect(Math.abs(total.revenue - revenue)).toBeLessThan(1e-6);
    const drill = (await admin.get('/profitability/entries?period=all')).body;
    const labour = drill.rows.reduce((a: number, r: { entry: { hours: number }; costRate: number }) => a + r.entry.hours * r.costRate, 0);
    expect(Math.abs(total.labour - labour)).toBeLessThan(1e-6);
    expect(Math.abs(total.margin - (total.revenue - total.labour - total.expenses))).toBeLessThan(1e-6);
    expect(total.revenue).toBeGreaterThan(0);
  });

  it('every margin traces to entry ids: the drill-down adds up to the figure shown', async () => {
    const { admin, input } = await frontendInput();
    const prof = (await admin.get('/profitability?period=all')).body;
    for (const pr of prof.projects.slice(0, 6)) {
      const d = (await admin.get('/profitability/entries?period=all&projectId=' + pr.projectId)).body;
      close(d, JSON.parse(JSON.stringify(sel.drill(sel.inPeriod(input, sel.PERIODS[0]), { projectId: pr.projectId }))), pr.projectId);
      expect(Math.abs(d.totals.margin - pr.margin), pr.projectId).toBeLessThan(1e-6);
      expect(d.rows.every((r: { entry: { id: string; projectId: string } }) => /^TE-/.test(r.entry.id) && r.entry.projectId === pr.projectId)).toBe(true);
    }
    // The entries' attributed revenue adds up to the lines that bill them.
    const all = (await admin.get('/profitability/entries?period=all')).body;
    const billedLines = sel.inPeriod(input, sel.PERIODS[0]).invoices.filter((i: { status: string }) => i.status !== 'Void').flatMap((i: { lines: { entryIds: string[]; amount: number }[] }) => i.lines).filter((l: { entryIds: string[] }) => l.entryIds.length);
    const attributed = all.rows.reduce((a: number, r: { revenue: number }) => a + r.revenue, 0);
    const lineTotal = billedLines.reduce((a: number, l: { amount: number }) => a + l.amount, 0);
    expect(lineTotal - attributed).toBeGreaterThanOrEqual(-1e-6); // lines whose hours fall outside the period attribute less
  });

  it('is Admin only (cost rates derive from salaries)', async () => {
    for (const role of ['HR', 'Manager', 'Employee'] as const) {
      expect((await (await signIn(role)).get('/profitability')).status, role).toBe(403);
      expect((await (await signIn(role)).get('/profitability/entries?projectId=P-214')).status, role).toBe(403);
    }
  });
});
