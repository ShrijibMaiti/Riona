import type { Approval, ApprovalStep, Employee, ExpenseClaim, Invoice, LeaveRequest, Notification, Project, RegularisationRequest, TimesheetEntry, TimesheetWeek } from '@riona/shared';
import { TODAY } from './calendar';
import { ME_ID } from './people';
import { addDays, streamFor, ts } from './rng';
import { PENDING_WEEK, RESUBMITTED } from './work';

const HR_ID = 'E-0107';
const FIN_ID = 'E-0124';

type Ctx = {
  emps: Employee[];
  leave: LeaveRequest[];
  expenses: ExpenseClaim[];
  weeks: TimesheetWeek[];
  entries: TimesheetEntry[];
  invoices: Invoice[];
  projects: Project[];
};

export function seedApprovals(c: Ctx): { approvals: Approval[]; regs: RegularisationRequest[] } {
  const byId = new Map(c.emps.map((e) => [e.id, e]));
  const out: Approval[] = [];
  let n = 1;
  const step = (approverId: string, role: string): ApprovalStep => ({ approverId, role, decision: null, at: null, comment: null });
  /** Build a chain and settle it: steps before `current` approved; a final status settles the rest. */
  const make = (type: Approval['type'], sourceId: string, requesterId: string, submitted: string, chain: ApprovalStep[], current: number, status: Approval['status'], comment?: string) => {
    chain[0] = { ...chain[0], decision: 'Approved', at: ts(submitted, '09:30') };
    const decidedAt = (i: number) => ts(addDays(submitted, i), '15:00');
    if (status === 'Pending') for (let i = 1; i < current; i++) chain[i] = { ...chain[i], decision: 'Approved', at: decidedAt(i) };
    if (status === 'Approved') for (let i = 1; i < chain.length; i++) chain[i] = { ...chain[i], decision: 'Approved', at: decidedAt(i) };
    if (status === 'Rejected') {
      for (let i = 1; i < current; i++) chain[i] = { ...chain[i], decision: 'Approved', at: decidedAt(i) };
      chain[current] = { ...chain[current], decision: 'Rejected', at: decidedAt(current), comment: comment ?? 'Please resubmit with details.' };
    }
    const a: Approval = { id: 'AP-' + String(n++).padStart(4, '0'), type, sourceId, requesterId, submitted, status, chain, current: status === 'Approved' ? chain.length - 1 : current };
    out.push(a);
    return a;
  };
  const mgrChain = (empId: string, last?: [string, string]) => {
    const e = byId.get(empId)!;
    const chain = [step(empId, 'Requester')];
    if (e.managerId) chain.push(step(e.managerId, 'Reporting manager'));
    const head = e.managerId ? byId.get(e.managerId)?.managerId : null;
    if (head && head !== 'E-0090' && head !== empId) chain.push(step(head, 'Department head'));
    if (last && !chain.some((s) => s.approverId === last[0])) chain.push(step(last[0], last[1]));
    return chain;
  };

  // Leave
  for (const l of c.leave) {
    if (l.status === 'Cancelled') continue;
    const chain = mgrChain(l.employeeId, l.days > 2 ? [HR_ID, 'HR'] : undefined);
    const meIdx = chain.findIndex((s, i) => i > 0 && s.approverId === ME_ID);
    const current = l.status === 'Pending' && meIdx > 0 ? meIdx : 1;
    const a = make('Leave', l.id, l.employeeId, l.submitted, chain, Math.min(current, chain.length - 1), l.status as Approval['status'],
      l.status === 'Rejected' ? 'Month-end close — could we move this to the following week?' : undefined);
    l.approvalId = a.id;
  }
  // Expenses
  for (const x of c.expenses) {
    if (x.status === 'Draft') continue;
    let chain: ApprovalStep[];
    let current = 1;
    if (x.description.includes('Postman')) {
      chain = [step(x.employeeId, 'Requester'), step('E-0118', 'Reporting manager'), step(ME_ID, 'Finance approver')];
      current = 2;
    } else {
      chain = mgrChain(x.employeeId).slice(0, 2);
      if (!chain.some((s) => s.approverId === FIN_ID)) chain.push(step(FIN_ID, 'Finance'));
    }
    const status = x.status === 'Pending' ? 'Pending' : x.status === 'Rejected' ? 'Rejected' : 'Approved';
    const a = make('Expense', x.id, x.employeeId, x.submitted, chain, current, status, 'Receipt is for a personal card — please attach the company card statement.');
    x.approvalId = a.id;
  }
  // Timesheets: the pending week, resubmissions, and the last three approved weeks.
  const recent = addDays(PENDING_WEEK, -14);
  for (const w of c.weeks) {
    const pend = w.status === 'Submitted';
    const resub = RESUBMITTED.some(([e, wk]) => e === w.employeeId && wk === w.weekStart);
    if (!pend && !resub && !(w.status === 'Approved' && w.weekStart >= recent)) continue;
    const proj = mainProject(c.entries, c.projects, w);
    const chain = [step(w.employeeId, 'Requester'), step(proj.mgr, 'Project manager')];
    if (proj.mgr !== ME_ID) chain.push(step(ME_ID, 'Delivery head'));
    const a = make('Timesheet', w.id, w.employeeId, addDays(w.weekStart, 4), chain, pend ? chain.length - 1 : 1, pend ? 'Pending' : 'Approved');
    w.approvalId = a.id;
  }
  // Regularisations
  const regs: RegularisationRequest[] = [];
  const reg = (employeeId: string, date: string, recorded: string, requested: string, reason: string, mark: RegularisationRequest['requestedMark'], rin: string | null, rout: string | null, submitted: string) => {
    const chain = mgrChain(employeeId);
    const meIdx = chain.findIndex((s, i) => i > 0 && s.approverId === ME_ID);
    const id = 'RG-' + (40 + regs.length);
    const a = make('Regularisation', id, employeeId, submitted, chain, meIdx > 0 ? meIdx : 1, 'Pending');
    regs.push({ id, employeeId, date, recorded, requested, reason, requestedMark: mark, requestedIn: rin, requestedOut: rout, approvalId: a.id });
  };
  reg('E-0121', '2026-11-03', '09:12 in · no out', '18:40 out', 'Badge reader at the Pune office was down after 6 pm.', 'P', '09:12', '18:40', '2026-11-04');
  reg('E-0142', '2026-11-02', 'Absent', 'Present · WFH', 'Forgot to mark WFH; was on the Warehouse Analytics stand-up.', 'WFH', '09:30', '18:30', '2026-11-03');
  // Invoices waiting on sign-off
  for (const inv of c.invoices.filter((i) => i.status === 'Draft')) {
    const a = make('Invoice', inv.id, FIN_ID, TODAY === inv.issued ? TODAY : addDays(inv.issued, 4), [step(FIN_ID, 'Requester'), step(ME_ID, 'Finance head')], 1, 'Pending');
    inv.approvalId = a.id;
  }
  return { approvals: out, regs };
}

function mainProject(entries: TimesheetEntry[], projects: Project[], w: TimesheetWeek): { mgr: string } {
  const end = addDays(w.weekStart, 6);
  const hours = new Map<string, number>();
  for (const t of entries) if (t.employeeId === w.employeeId && t.date >= w.weekStart && t.date <= end) hours.set(t.projectId, (hours.get(t.projectId) ?? 0) + t.hours);
  const top = [...hours].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { mgr: projects.find((p) => p.id === top)?.managerId ?? 'E-0104' };
}

export function seedNotifications(approvals: Approval[]): Notification[] {
  const r = streamFor('notifs');
  const mine = approvals.filter((a) => a.status === 'Pending' && a.chain[a.current].approverId === ME_ID).slice(0, 4);
  const ago = ['2026-11-06T09:48:00+05:30', '2026-11-06T08:10:00+05:30', '2026-11-05T17:20:00+05:30', '2026-11-05T11:00:00+05:30'];
  const out: Notification[] = mine.map((a, i) => ({ id: 'NT-' + i, at: ago[i], kind: 'Approval', text: '', href: '/app/approvals', approvalId: a.id, actorId: a.requesterId, recipientId: ME_ID, read: false }));
  out.push(
    { id: 'NT-10', at: '2026-11-06T09:00:00+05:30', kind: 'Mention', text: 'Tara Fernandes mentioned you on FO-41 — “Can we ship the drag handles this sprint?”', href: '/app/work/projects/P-214', approvalId: null, actorId: 'E-0127', recipientId: ME_ID, read: false },
    { id: 'NT-11', at: '2026-11-05T10:00:00+05:30', kind: 'Payroll', text: 'October payroll disbursed.', href: '/app/people/payroll', approvalId: null, actorId: null, recipientId: ME_ID, read: true },
    { id: 'NT-12', at: '2026-11-04T16:00:00+05:30', kind: 'Mention', text: 'Sana Qureshi mentioned you on an invoice — “Need your sign-off before Friday.”', href: '/app/finance/invoices', approvalId: null, actorId: 'E-0124', recipientId: ME_ID, read: false },
    { id: 'NT-13', at: '2026-11-04T09:00:00+05:30', kind: 'Contracts', text: 'Bluefin Capital’s master services agreement expires on 30 November.', href: '/app/clients/contracts', approvalId: null, actorId: null, recipientId: ME_ID, read: true },
  );
  void r;
  return out;
}
