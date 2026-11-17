/**
 * The demo seed's integrity (moved here from the frontend in Wave 9, with the seed).
 * Reconciliation: the same figure must be the same everywhere.
 * For every client and every project in the seed:
 *   revenue    == Σ its invoice line totals
 *   labourCost == Σ (hours × costRate) for its entries
 *   margin     == revenue − labourCost − expenses
 * If this fails, the seed (or a selector) is wrong — not the test.
 */
import { describe, expect, it } from 'vitest';
import { createSeed } from '../../db/seed/demo';
import { isSpent } from '../../../frontend/app/src/data/selectors/finance';
import { costRate } from '../../../frontend/app/src/data/selectors/payroll';
import { profitability } from '../../../frontend/app/src/data/selectors/profitability';

const db = createSeed();
const p = profitability(db);
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);
const evOf = (id: string) => db.salaryEvents.filter((e) => e.employeeId === id);
const labourOf = (pred: (e: (typeof db.entries)[number]) => boolean) =>
  db.entries.filter(pred).reduce((a, e) => a + e.hours * costRate(evOf(e.employeeId), e.date).value, 0);
const liveInvoices = db.invoices.filter((i) => i.status !== 'Void');

describe('seed integrity', () => {
  it('is deterministic', () => {
    const again = createSeed();
    expect(JSON.stringify(again.entries)).toBe(JSON.stringify(db.entries));
    expect(JSON.stringify(again.invoices)).toBe(JSON.stringify(db.invoices));
  });
  it('has the specified volumes', () => {
    expect(db.employees).toHaveLength(60);
    expect(db.clients).toHaveLength(8);
    expect(db.projects).toHaveLength(15);
    expect(db.entries.length).toBeGreaterThan(3500);
    expect(db.entries.length).toBeLessThan(5000);
    expect(db.invoices.length).toBeGreaterThanOrEqual(38);
    expect(db.invoices.length).toBeLessThanOrEqual(45);
    expect(db.expenses).toHaveLength(200);
    expect(db.payrollRuns).toHaveLength(6);
    for (const e of db.employees) expect(db.salaryEvents.some((x) => x.employeeId === e.id && x.type === 'Hired')).toBe(true);
  });
  it('every timesheet entry references a real employee, project and client', () => {
    const emps = new Set(db.employees.map((e) => e.id));
    const projs = new Map(db.projects.map((x) => [x.id, x]));
    const clients = new Set(db.clients.map((c) => c.id));
    for (const t of db.entries) {
      expect(emps.has(t.employeeId)).toBe(true);
      expect(projs.get(t.projectId)?.clientId).toBe(t.clientId);
      expect(clients.has(t.clientId)).toBe(true);
    }
  });
  it('every time line references real entries for its project, client and hours', () => {
    const byId = new Map(db.entries.map((e) => [e.id, e]));
    const projs = new Map(db.projects.map((x) => [x.id, x]));
    for (const inv of db.invoices) for (const l of inv.lines) {
      for (const id of l.entryIds) {
        const e = byId.get(id);
        expect(e, id).toBeDefined();
        expect(e!.projectId).toBe(l.projectId);
        expect(e!.clientId).toBe(inv.clientId);
      }
      if (l.kind === 'time') {
        expect(l.entryIds.length).toBeGreaterThan(0);
        near(l.entryIds.reduce((a, id) => a + byId.get(id)!.hours, 0), l.quantity);
        expect(l.amount).toBe(Math.round(l.quantity * l.rate));
      }
      if (l.projectId) expect(projs.get(l.projectId)!.clientId).toBe(inv.clientId);
    }
  });
  it('no entry is billed twice', () => {
    const seen = new Set<string>();
    for (const inv of liveInvoices) for (const l of inv.lines) if (l.kind === 'time') for (const id of l.entryIds) {
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
    }
  });
  it('every payroll run references real salary events and covers its attendance', () => {
    const ev = new Map(db.salaryEvents.map((e) => [e.id, e]));
    for (const r of db.payrollRuns) {
      expect(r.salaryEventIds.length).toBeGreaterThan(0);
      for (const id of r.salaryEventIds) expect(r.employeeIds).toContain(ev.get(id)!.employeeId);
      expect(db.attendance.some((a) => a.date === r.attendanceFrom)).toBe(true);
    }
  });
});

describe('profitability reconciles', () => {
  it.each(db.clients.map((c) => [c.name, c.id]))('client %s', (_n, id) => {
    const row = p.clients.find((c) => c.clientId === id)!;
    const revenue = liveInvoices.filter((i) => i.clientId === id).flatMap((i) => i.lines).reduce((a, l) => a + l.amount, 0);
    const labour = labourOf((e) => e.clientId === id);
    const expenses = db.expenses.filter((x) => isSpent(x) && x.clientId === id).reduce((a, x) => a + x.amount, 0);
    near(row.revenue, revenue);
    near(row.labour, labour);
    near(row.expenses, expenses);
    near(row.margin, revenue - labour - expenses);
  });
  it.each(db.projects.map((x) => [x.name, x.id]))('project %s', (_n, id) => {
    const row = p.projects.find((x) => x.projectId === id)!;
    const revenue = liveInvoices.flatMap((i) => i.lines).filter((l) => l.projectId === id).reduce((a, l) => a + l.amount, 0);
    const labour = labourOf((e) => e.projectId === id);
    const expenses = db.expenses.filter((x) => isSpent(x) && x.projectId === id).reduce((a, x) => a + x.amount, 0);
    near(row.revenue, revenue);
    near(row.labour, labour);
    near(row.margin, revenue - labour - expenses);
    // People rows plus the non-person remainder add back up to the project.
    const ppl = row.people.reduce((a, x) => a + x.margin, 0);
    near(ppl + row.other.revenue - row.other.expenses, row.margin);
  });
  it('totals equal the sum of clients', () => {
    near(p.total.revenue, p.clients.reduce((a, c) => a + c.revenue, 0));
    near(p.total.margin, p.total.revenue - p.total.labour - p.total.expenses);
  });
});

describe('drill-through reconciles with the figure clicked', async () => {
  const { drill } = await import('../../../frontend/app/src/data/selectors/profitability');
  it.each(db.clients.map((c) => [c.name, c.id]))('client %s', (_n, id) => {
    const row = p.clients.find((c) => c.clientId === id)!;
    const d = drill(db, { clientId: id });
    near(d.totals.revenue, row.revenue);
    near(d.totals.labour, row.labour);
    near(d.totals.margin, row.margin);
  });
  it.each(db.projects.map((x) => [x.name, x.id]))('project %s', (_n, id) => {
    const row = p.projects.find((x) => x.projectId === id)!;
    const d = drill(db, { projectId: id });
    near(d.totals.margin, row.margin);
    for (const person of row.people) {
      const pd = drill(db, { projectId: id, employeeId: person.employeeId });
      near(pd.totals.labour, person.labour);
      near(pd.totals.margin, person.margin);
    }
  });
});
