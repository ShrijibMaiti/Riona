/**
 * Every figure the hubs and dashboards show, computed from repository output.
 * Nothing here is typed in by hand: change the data and these change.
 */
import { addDays, isWeekend, mondayOf, NOW } from '../../lib/dates';
import { hours, inr, lakh, monthLabel, dm } from '../../lib/format';
import type {
  AppUser, Approval, ApprovalWithSource, Asset, AttendanceDay, AuditEvent, Booking, Budget, Candidate, Certification, Client, Contract, Employee, ExpenseClaim, Holiday, Invoice,
  InventoryItem, Job, KbArticle, Lead, LeaveRequest, LeaveType, OnboardingCase, PayrollRun, Project, Review, SalaryEvent, SystemJob, Task, Ticket,
  TimesheetEntry, Announcement, Visitor, Workflow,
} from '../types';
import { awaitingMe } from './approvals';
import { isSpent, linesSubtotal, receivables, revenueIssuedIn } from './finance';
import { isPresent, isScheduled, leaveBalances, teamOf } from './people';
import { profitability } from './profitability';

export type FactsInput = {
  today: string;
  /** The server's clock (ISO); defaults to the demo's fixed moment. */
  now?: string;
  meId: string;
  employees: Employee[];
  attendance: AttendanceDay[];
  leave: LeaveRequest[];
  leaveTypes: LeaveType[];
  holidays: Holiday[];
  approvals: ApprovalWithSource[];
  entries: TimesheetEntry[];
  invoices: Invoice[];
  expenses: ExpenseClaim[];
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  salaryEvents: SalaryEvent[];
  leads: Lead[];
  contracts: Contract[];
  tickets: Ticket[];
  assets: Asset[];
  inventory: InventoryItem[];
  bookings: Booking[];
  visitors: Visitor[];
  users: AppUser[];
  workflows: Workflow[];
  audit: AuditEvent[];
  systemJobs: SystemJob[];
  payrollRuns: PayrollRun[];
  jobs: Job[];
  candidates: Candidate[];
  onboarding: OnboardingCase[];
  reviews: Review[];
  certifications: Certification[];
  announcements: Announcement[];
  kb: KbArticle[];
  budgets: Budget[];
};

const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

export function computeFacts(x: FactsInput) {
  const t = x.today;
  const me = x.employees.find((e) => e.id === x.meId)!;
  const month = t.slice(0, 7);
  const weekStart = mondayOf(t);
  const pending = (type: Approval['type']) => x.approvals.filter((a) => a.type === type && a.status === 'Pending').length;
  const pendingMine = x.approvals.filter((a) => awaitingMe(a, x.meId));
  const empById = new Map(x.employees.map((e) => [e.id, e]));

  // ---- people ----
  const active = x.employees.filter((e) => e.status !== 'Inactive');
  const joinedThisMonth = active.filter((e) => e.joined.startsWith(month)).length;
  const todayAtt = x.attendance.filter((a) => a.date === t);
  const present = todayAtt.filter(isPresent).length;
  const scheduled = todayAtt.filter(isScheduled).length;
  const onLeave = todayAtt.filter((a) => a.mark === 'Leave').length;
  const prior = Array.from({ length: 28 }, (_, i) => addDays(t, -i - 1));
  const leaveByDay = prior.filter((d) => !isWeekend(d)).map((d) => x.attendance.filter((a) => a.date === d && a.mark === 'Leave').length);
  const usualLeave = Math.round(leaveByDay.reduce((a, b) => a + b, 0) / Math.max(1, leaveByDay.length));
  const openJobs = x.jobs.filter((j) => j.status === 'Open');
  const openPositions = openJobs.reduce((a, j) => a + j.openings, 0);
  const applicants = x.candidates.filter((c) => c.stage !== 'Rejected' && c.stage !== 'Hired' && openJobs.some((j) => j.id === c.jobId)).length;
  const run = x.payrollRuns.find((r) => r.month === month);
  const joining30 = x.onboarding.filter((o) => o.kind === 'Joining' && o.date > t && o.date <= addDays(t, 30)).length;
  const h2 = x.reviews.filter((r) => r.cycleId === 'RC-H2-26');
  const selfIn = h2.length ? Math.round((h2.filter((r) => r.status !== 'Not started').length / h2.length) * 100) : 0;
  const expiringCerts = x.certifications.filter((c) => c.status === 'Expiring' || c.status === 'Expired').length;
  const certsLapsed = x.certifications.filter((c) => c.status === 'Expired').length;
  const nextWeek = [0, 1, 2, 3, 4].map((i) => addDays(addDays(weekStart, 7), i));
  const awayNextWeek = new Set(x.leave.filter((l) => l.status === 'Approved' && nextWeek.some((d) => d >= l.from && d <= l.to)).map((l) => l.employeeId)).size;
  const deliveryHeads = x.employees.filter((e) => e.dept === 'Delivery' || e.dept === 'Engineering' || e.dept === 'Design');
  const peakDelivery = (() => {
    let best = { d: '', pct: 0 };
    for (let i = 0; i < 60; i++) {
      const d = addDays(t, i);
      const away = new Set(x.leave.filter((l) => (l.status === 'Approved' || l.status === 'Pending') && d >= l.from && d <= l.to && deliveryHeads.some((e) => e.id === l.employeeId)).map((l) => l.employeeId)).size;
      const pct = Math.round((away / deliveryHeads.length) * 100);
      if (pct > best.pct) best = { d, pct };
    }
    return best;
  })();

  // ---- work ----
  const activeProjects = x.projects.filter((p) => p.status === 'Active');
  const atRisk = activeProjects.filter((p) => p.health === 'At risk' || p.health === 'Off track');
  const weekEntries = x.entries.filter((e) => e.date >= weekStart && e.date <= t);
  const weekHours = weekEntries.reduce((a, e) => a + e.hours, 0);
  const billableHeads = new Set(x.entries.filter((e) => e.date >= addDays(t, -30)).map((e) => e.employeeId)).size;
  const daysElapsed = Math.min(5, Math.round((Date.parse(t) - Date.parse(weekStart)) / 864e5) + 1);
  const capacityPct = billableHeads ? Math.round((weekHours / (billableHeads * 8 * daysElapsed)) * 100) : 0;
  const overdue = x.tasks.filter((k) => k.status !== 'done' && k.due < t);
  const dueThisWeek = x.tasks.filter((k) => k.status !== 'done' && k.due >= t && k.due <= addDays(weekStart, 6));
  const billedIds = new Set(x.invoices.filter((i) => i.status !== 'Void').flatMap((i) => i.lines.flatMap((l) => l.entryIds)));
  const unbilled = x.entries.filter((e) => e.billable && e.status === 'Approved' && !billedIds.has(e.id) && x.projects.find((p) => p.id === e.projectId)?.model === 'T&M');
  const unbilledHours = unbilled.reduce((a, e) => a + e.hours, 0);
  const unbilledValue = unbilled.reduce((a, e) => a + e.hours * (empById.get(e.employeeId)?.billRate ?? 0), 0);
  const nextHoliday = x.holidays.find((h) => h.date > t);

  // ---- clients ----
  const activeClients = x.clients.filter((c) => x.projects.some((p) => p.clientId === c.id && p.status === 'Active'));
  const openLeads = x.leads.filter((l) => l.stage !== 'Won' && l.stage !== 'Lost');
  const pipeline = openLeads.reduce((a, l) => a + l.value, 0);
  const expiring = x.contracts.filter((c) => c.status === 'Active' && c.end >= t && c.end <= addDays(t, 60)).sort((a, b) => a.end.localeCompare(b.end));
  const nextExpiry = expiring[0];
  const openTickets = x.tickets.filter((k) => k.status !== 'Resolved');
  const breached = openTickets.filter((k) => k.slaDue < (x.now ?? NOW));
  const rec = receivables(x.invoices, x.clients, t);

  // ---- finance ----
  const revenue = revenueIssuedIn(x.invoices, month);
  const lastMonth = month === '2026-01' ? '2025-12' : month.slice(0, 5) + String(+month.slice(5) - 1).padStart(2, '0');
  // Like for like: this month so far against the same days of last month, not against the whole of last month.
  const revenuePrev = revenueIssuedIn(x.invoices, lastMonth, +t.slice(8, 10));
  const revDelta = revenuePrev ? ((revenue - revenuePrev) / revenuePrev) * 100 : 0;
  const pendingExp = x.expenses.filter((e) => e.status === 'Pending');
  const prof = profitability(x);
  const worstClient = prof.clients[0];
  const spentBy = (dept: string) => x.expenses.filter((e) => isSpent(e) && empById.get(e.employeeId)?.dept === dept && e.date >= '2026-04-01').reduce((a, e) => a + e.amount, 0);
  const budgetUse = x.budgets.map((b) => ({ dept: b.dept, pct: Math.round(((b.committed + spentBy(b.dept)) / b.planned) * 100) })).sort((a, b) => b.pct - a.pct);

  // ---- workplace ----
  const allocated = x.assets.filter((a) => a.status === 'Allocated').length;
  const available = x.assets.filter((a) => a.status === 'Available').length;
  const repair = x.assets.filter((a) => a.status === 'Under repair').length;
  const low = x.inventory.filter((i) => i.stock < i.reorderLevel);
  const nowHm = (x.now ?? NOW).slice(11, 16);
  const todayBookings = x.bookings.filter((b) => b.date === t);
  const roomsNow = new Set(todayBookings.filter((b) => b.start <= nowHm && b.end > nowHm).map((b) => b.roomId)).size;
  const peakHour = (() => {
    let best = { h: 9, n: 0 };
    for (let h = 9; h < 19; h++) {
      const hm = String(h).padStart(2, '0') + ':30';
      const n = new Set(todayBookings.filter((b) => b.start <= hm && b.end > hm).map((b) => b.roomId)).size;
      if (n > best.n) best = { h, n };
    }
    return String(best.h).padStart(2, '0') + ':00';
  })();
  const visitorsToday = x.visitors.filter((v) => v.date === t);
  const onSite = visitorsToday.filter((v) => v.checkedIn && !v.checkedOut).length;
  const pinned = x.announcements.find((a) => a.requiresAck) ?? x.announcements[0];
  const ackPct = pinned && pinned.audienceIds.length ? Math.round((pinned.ackIds.length / pinned.audienceIds.length) * 100) : 0;
  const kbThisWeek = x.kb.filter((k) => k.updated >= weekStart).length;

  // ---- admin ----
  const invited = x.users.filter((u) => u.status === 'Invited').length;
  const activeWf = x.workflows.filter((w) => w.status === 'Active').length;
  const auditToday = x.audit.filter((a) => a.at.slice(0, 10) === t).length;
  const failed = x.systemJobs.filter((j) => j.status === 'Failed');

  // ---- me ----
  const myLeave = x.leave.filter((l) => l.employeeId === x.meId);
  const balances = leaveBalances(me, x.leaveTypes, myLeave, t);
  const myBalance = balances.filter((b) => b.code !== 'CO').reduce((a, b) => a + b.available, 0);
  const myWeek = x.entries.filter((e) => e.employeeId === x.meId && e.date >= weekStart && e.date <= addDays(weekStart, 6));
  const myHours = myWeek.reduce((a, e) => a + e.hours, 0);
  const myPendingClaims = x.expenses.filter((e) => e.employeeId === x.meId && (e.status === 'Pending' || e.status === 'Approved'));
  const myAssets = x.assets.filter((a) => a.allocations.some((al) => al.employeeId === x.meId && !al.to));
  const myAtt = x.attendance.filter((a) => a.employeeId === x.meId && a.date.startsWith(month) && isScheduled(a) && a.mark !== 'Leave');
  const onTime = myAtt.filter((a) => a.mark === 'P' || a.mark === 'WFH').length;
  const myTasks = x.tasks.filter((k) => k.assigneeId === x.meId && k.status !== 'done');
  const myOverdue = myTasks.filter((k) => k.due < t).length;
  const teamIds = new Set(teamOf(x.employees, x.meId).map((e) => e.id));
  const teamWeek = weekEntries.filter((e) => teamIds.has(e.employeeId));
  const teamHours = teamWeek.reduce((a, e) => a + e.hours, 0);
  const teamBillablePct = teamHours ? Math.round((teamWeek.filter((e) => e.billable).reduce((a, e) => a + e.hours, 0) / teamHours) * 100) : 0;
  const teamPresent = todayAtt.filter((a) => teamIds.has(a.employeeId) && isPresent(a)).length;
  const teamScheduled = todayAtt.filter((a) => teamIds.has(a.employeeId) && isScheduled(a)).length;
  const lastRun = [...x.payrollRuns].filter((r) => r.stage === 'Disbursed').pop();

  return {
    today: t, me, month,
    pendingMine: pendingMine.length,
    people: {
      headcount: active.length, joinedThisMonth, present, scheduled, onLeave, usualLeave,
      leaveDelta: onLeave - usualLeave === 0 ? 'About the usual' : Math.abs(onLeave - usualLeave) + (onLeave > usualLeave ? ' above' : ' below') + ' the usual',
      openPositions, applicants, openRoles: openJobs.length, regularisation: pending('Regularisation'), leavePending: pending('Leave'),
      payrollStage: run ? (run.stage === 'Inputs' ? 'Review inputs' : run.stage) : '—', payrollMonth: run ? monthLabel(run.month).split(' ')[0] : '', payrollLock: run ? dm(run.lockDate) : '',
      joining30, selfIn, expiringCerts, certsLapsed, awayNextWeek, peakDelivery,
      departments: new Set(active.map((e) => e.dept)).size, locations: new Set(active.map((e) => e.location)).size,
    },
    work: {
      activeProjects: activeProjects.length, atRisk: atRisk.length, atRiskNames: atRisk.map((p) => p.name),
      weekHours, capacityPct, overdue: overdue.length, dueThisWeek: dueThisWeek.length,
      unbilledHours, unbilledValue, timesheetPending: pending('Timesheet'), nextHoliday,
    },
    clients: {
      active: activeClients.length, pipeline, openDeals: openLeads.length, expiring: expiring.length, nextExpiry,
      nextExpiryClient: nextExpiry ? x.clients.find((c) => c.id === nextExpiry.clientId)?.name : undefined,
      openTickets: openTickets.length, breached: breached.length, outstanding: rec.outstanding, clientsOwing: rec.clientsOwing,
    },
    finance: {
      revenue, revDelta, revenuePrevLabel: monthLabel(lastMonth).split(' ')[0], outstanding: rec.outstanding, over60: rec.over60,
      expensesPending: pendingExp.length, expensesPendingAmount: pendingExp.reduce((a, e) => a + e.amount, 0),
      margin: prof.total.pct, worstClient: worstClient ? { name: x.clients.find((c) => c.id === worstClient.clientId)?.name ?? '', pct: worstClient.pct } : null,
      topBudget: budgetUse[0], unbilledValue,
    },
    workplace: {
      tracked: x.assets.length, allocated, available, repair, low: low.map((i) => i.name), roomsNow, rooms: new Set(x.bookings.map((b) => b.roomId)).size, peakHour,
      visitorsToday: visitorsToday.length, onSite, pinnedTitle: pinned?.title ?? '', ackPct, kbThisWeek, nextVisitor: visitorsToday.find((v) => !v.checkedIn),
    },
    admin: {
      users: x.users.length, invited, activeWf, workflows: x.workflows.length, paused: x.workflows.length - activeWf, auditToday, failed,
    },
    mine: {
      balance: myBalance, balances, hours: myHours, pendingClaims: myPendingClaims.reduce((a, e) => a + e.amount, 0), pendingClaimsCount: myPendingClaims.length,
      assets: myAssets.map((a) => a.category), leavePending: myLeave.filter((l) => l.status === 'Pending').length,
      onTime, attDays: myAtt.length, tasksOverdue: myOverdue, tasksThisWeek: myTasks.filter((k) => k.due >= t && k.due <= addDays(weekStart, 6)).length,
      lastPayslip: lastRun ? monthLabel(lastRun.month) : '—',
      teamHours, teamBillablePct, teamPresent, teamScheduled, teamSize: teamIds.size,
    },
  };
}
export type Facts = ReturnType<typeof computeFacts>;

export { hours, inr, lakh, plural, linesSubtotal };
