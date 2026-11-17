import type { Budget, Client, Employee, ExpenseCategory, ExpenseClaim, Invoice, InvoiceLine, Project, TimesheetEntry } from '@riona/shared';
import { TODAY } from './calendar';
import { addDays, endOfMonth, isWeekend, monthOf, streamFor, ts } from './rng';

const CAT_DESC: Record<ExpenseCategory, string[]> = {
  Travel: ['Flights to client site', 'Cab to client office', 'Train to Pune depot', 'Hotel, one night'],
  Meals: ['Working lunch with client', 'Team dinner after release', 'Workshop lunch'],
  Software: ['Figma seat, monthly', 'Postman, annual seat', 'JetBrains licence', 'Test devices cloud, monthly'],
  Hardware: ['USB-C dock', 'Mechanical keyboard', 'Test Android device'],
  Training: ['AWS certification exam', 'Conference ticket', 'Online course'],
  'Client entertainment': ['Client dinner', 'Go-live celebration'],
  Office: ['Stationery', 'Courier to client', 'Printing'],
};

/** Design-specified claims that must exist as pending. */
const FIXED: Partial<ExpenseClaim>[] = [
  { employeeId: 'E-0133', category: 'Travel', description: 'Travel · Pune depot visit', amount: 18400, date: '2026-10-30', projectId: 'P-214', clientId: 'C-11', billable: true, status: 'Pending', submitted: '2026-11-02' },
  { employeeId: 'E-0154', category: 'Software', description: 'Software · Postman, annual seat', amount: 6240, date: '2026-10-31', projectId: null, clientId: null, billable: false, status: 'Pending', submitted: '2026-11-01' },
  { employeeId: 'E-0127', category: 'Meals', description: 'Meals · Aster workshop', amount: 3180, date: '2026-10-29', projectId: 'P-208', clientId: 'C-14', billable: true, status: 'Approved', submitted: '2026-10-30' },
];

export function seedExpenses(emps: Employee[], projects: Project[]): ExpenseClaim[] {
  const r = streamFor('expenses');
  const out: ExpenseClaim[] = [];
  const add = (c: Omit<ExpenseClaim, 'id' | 'revisions' | 'approvalId' | 'reimbursedOn' | 'receipt'> & { receipt?: boolean }) =>
    out.push({ receipt: true, ...c, id: 'EXP-' + String(700 + out.length).padStart(4, '0'), approvalId: null, reimbursedOn: c.status === 'Reimbursed' ? addDays(c.submitted, 9) : null, revisions: [] });
  const active = emps.filter((e) => e.status !== 'Inactive');
  while (out.length < 197) {
    const e = r.pick(active);
    let date = addDays('2026-05-04', r.int(0, 184));
    if (date > TODAY) continue;
    while (isWeekend(date)) date = addDays(date, -1);
    if (date < e.joined) continue;
    const myProjects = projects.filter((p) => p.team.some((m) => m.employeeId === e.id) && date >= p.start && date <= p.end);
    const clientFacing = (e.dept === 'Sales' && r.chance(0.7)) || (myProjects.length > 0 && r.chance(0.3));
    const pool: ExpenseCategory[] = clientFacing ? ['Travel', 'Travel', 'Meals', 'Client entertainment'] : ['Software', 'Hardware', 'Training', 'Office', 'Meals'];
    const category = r.pick(pool);
    const proj = clientFacing ? (myProjects.length ? r.pick(myProjects) : r.pick(projects.filter((p) => date >= p.start && date <= p.end).length ? projects.filter((p) => date >= p.start && date <= p.end) : projects)) : null;
    const base = { Travel: [2400, 22000], Meals: [900, 5200], Software: [1200, 9800], Hardware: [1800, 14000], Training: [3000, 18000], 'Client entertainment': [4000, 16000], Office: [300, 2400] }[category];
    const amount = Math.round((base[0] + r() * (base[1] - base[0])) / 10) * 10;
    const submitted = addDays(date, r.int(0, 4)) > TODAY ? TODAY : addDays(date, r.int(0, 4));
    const recent = date >= '2026-10-20';
    const status = recent ? (r.chance(0.45) ? 'Pending' : 'Approved') : r.chance(0.05) ? 'Rejected' : r.chance(0.06) ? 'Approved' : 'Reimbursed';
    add({
      employeeId: e.id, category, description: category + ' · ' + r.pick(CAT_DESC[category]), amount, date,
      projectId: proj?.id ?? null, clientId: proj?.clientId ?? null, billable: !!proj && category !== 'Client entertainment',
      status, submitted, receipt: r.chance(0.95),
    });
  }
  for (const f of FIXED) add(f as ExpenseClaim);
  // Two reopened claims carry their earlier approved state.
  const reopened = out.filter((x) => x.status === 'Reimbursed' && x.amount > 5000).slice(0, 2);
  reopened.forEach((x, i) => {
    x.revisions.push({ at: ts(x.submitted, '11:00'), amount: x.amount + (i ? 1200 : 2650), description: x.description, status: 'Approved', reason: '' });
    x.revisions.push({ at: ts(addDays(x.submitted, 6), '16:20'), amount: x.amount, description: x.description, status: 'Approved', reason: i ? 'Reopened: one receipt was a duplicate.' : 'Reopened: hotel invoice showed a lower final amount.' });
  });
  return out;
}

const MILESTONE_SHARE = [0.2, 0.3, 0.3, 0.2];
/** Clients whose October work has not been invoiced yet — feeds New invoice. */
export const UNBILLED_OCT = ['C-11', 'C-17', 'C-28'];

export function seedInvoices(clients: Client[], projects: Project[], emps: Employee[], entries: TimesheetEntry[], expenses: ExpenseClaim[]): Invoice[] {
  const rate = new Map(emps.map((e) => [e.id, e.billRate]));
  const name = new Map(emps.map((e) => [e.id, e.name]));
  const out: Invoice[] = [];
  let num = 121;
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const usedExp = new Set<string>();
  for (const m of months) {
    const issued = addDays(endOfMonth(m), 1);
    for (const c of clients) {
      if (m === '2026-10' && UNBILLED_OCT.includes(c.id)) continue;
      const lines: InvoiceLine[] = [];
      let ln = 1;
      for (const p of projects.filter((x) => x.clientId === c.id)) {
        if (p.model === 'T&M') {
          const es = entries.filter((t) => t.projectId === p.id && t.billable && t.status === 'Approved' && monthOf(t.date) === m);
          const byEmp = new Map<string, TimesheetEntry[]>();
          for (const t of es) byEmp.set(t.employeeId, [...(byEmp.get(t.employeeId) ?? []), t]);
          for (const [eid, list] of [...byEmp].sort((a, b) => a[0].localeCompare(b[0]))) {
            const qty = list.reduce((a, t) => a + t.hours, 0);
            const r = rate.get(eid)!;
            lines.push({ id: '', kind: 'time', projectId: p.id, description: p.name + ' · ' + name.get(eid), entryIds: list.map((t) => t.id), expenseIds: [], quantity: qty, unit: 'h', rate: r, amount: Math.round(qty * r) });
          }
        } else {
          p.milestones.forEach((ms, i) => {
            if (monthOf(ms.date) !== m || ms.date > TODAY) return;
            const prev = i ? p.milestones[i - 1].date : p.start;
            const ids = entries.filter((t) => t.projectId === p.id && t.date > prev && t.date <= ms.date && t.status === 'Approved').map((t) => t.id);
            const amt = Math.round((p.fee ?? 0) * MILESTONE_SHARE[i]);
            lines.push({ id: '', kind: 'milestone', projectId: p.id, description: p.name + ' · ' + ms.name + ' milestone (' + Math.round(MILESTONE_SHARE[i] * 100) + '% of fee)', entryIds: ids, expenseIds: [], quantity: 1, unit: 'item', rate: amt, amount: amt });
          });
        }
      }
      for (const x of expenses.filter((x) => x.clientId === c.id && x.billable && (x.status === 'Approved' || x.status === 'Reimbursed') && monthOf(x.date) === m && !usedExp.has(x.id))) {
        usedExp.add(x.id);
        lines.push({ id: '', kind: 'expense', projectId: x.projectId, description: 'Billable expense · ' + x.description, entryIds: [], expenseIds: [x.id], quantity: 1, unit: 'item', rate: x.amount, amount: x.amount });
      }
      if (!lines.length) continue;
      const id = 'INV-2026-' + String(num++).padStart(4, '0');
      lines.forEach((l) => (l.id = id + '-L' + ln++));
      const due = addDays(issued, c.paymentTermsDays);
      out.push({ id, number: id, clientId: c.id, issued, due, status: 'Sent', lines, discount: 0, notes: 'Thank you for your business. Bank details are on page two.', payments: [], revisions: [], approvalId: null });
    }
  }
  // Payment history. Slow payers keep balances open.
  const slow: Record<string, number> = { 'C-19': 0.35, 'C-22': 0.55, 'C-17': 0.8 };
  for (const inv of out) {
    const r = streamFor('pay:' + inv.id);
    const total = inv.lines.reduce((a, l) => a + l.amount, 0) * 1.18;
    const willPay = r() < (slow[inv.clientId] ?? 0.95);
    const payDate = addDays(inv.due, r.int(-8, 12));
    if (willPay && payDate <= TODAY) {
      inv.payments.push({ id: inv.id + '-P1', date: payDate, amount: Math.round(total), method: r.pick(['NEFT', 'RTGS', 'NEFT']), reference: 'UTR' + r.int(100000000, 999999999) });
      inv.status = 'Paid';
    } else if (inv.due < TODAY) {
      inv.status = 'Overdue';
    }
  }
  // One partial payment; one invoice revised after issue; the newest Halcyon invoice is a draft waiting on approval.
  const partial = out.find((i) => i.clientId === 'C-14' && i.issued === '2026-11-01');
  if (partial) {
    partial.payments = [{ id: partial.id + '-P1', date: '2026-11-04', amount: 400000, method: 'NEFT', reference: 'UTR772019344' }];
    partial.status = 'Partially paid';
  }
  const revised = out.find((i) => i.clientId === 'C-14' && i.issued === '2026-10-01');
  if (revised && revised.lines[0]) {
    const old = revised.lines.map((l) => ({ ...l }));
    old[0] = { ...old[0], quantity: old[0].quantity + 6, amount: Math.round((old[0].quantity + 6) * old[0].rate) };
    revised.revisions.push({ at: ts('2026-10-01', '10:00'), reason: 'Issued', lines: old, discount: 0 });
    revised.revisions.push({ at: ts('2026-10-06', '14:30'), reason: 'Revised: 6 h logged to the wrong project were removed.', lines: revised.lines.map((l) => ({ ...l })), discount: 0 });
  }
  const draft = out.filter((i) => i.clientId === 'C-19').pop();
  if (draft && draft.issued === '2026-11-01') {
    draft.status = 'Draft';
    draft.payments = [];
  }
  return out;
}

export function seedBudgets(): Budget[] {
  const rows: [Budget['dept'], number, number][] = [
    ['Sales', 4200000, 4452000], ['Design', 3600000, 3348000], ['Operations', 2800000, 2492000], ['Engineering', 9800000, 8428000],
    ['Delivery', 3100000, 2604000], ['Finance', 1500000, 1140000], ['People', 2200000, 1606000], ['Leadership', 1800000, 1260000],
  ];
  return rows.map(([dept, planned, committed], i) => ({
    id: 'BG-' + (i + 1), dept, fy: 'FY 2026–27', planned, committed,
    lines: [['Travel', 0.25], ['Software', 0.3], ['Training', 0.15], ['Events', 0.1], ['Hardware', 0.2]].map(([c, s]) => ({ category: c as string, planned: Math.round(planned * (s as number)) })),
  }));
}
