/**
 * GET /dashboard-facts and GET /dashboard-blocks: what the dashboards and hubs show, computed here instead of in
 * the browser (which used to load every collection to work it out).
 *
 * The inputs are built through the same services the API uses, as the signed-in person, so each list is exactly
 * what they could fetch themselves; a list they may not see is simply empty. The figures, attention lists, the
 * dashboard list and the analytics blocks then come from the shared selectors (frontend/app/src/data/selectors), so
 * the numbers are the ones the screens always showed.
 */
import type { Role } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import type { Actor } from '../../http/plugins/session';
import { forbidden, isApiError } from '../../lib/errors';
import { nowZoned, today } from '../../lib/dates';
import { parse } from '../../lib/validate';
import { dashboardFacts, type DashboardFacts } from '../../../../frontend/app/src/data/selectors/dashboard';
import { buildBlocks, RANGES, type BlockModel } from '../../../../frontend/app/src/data/selectors/blocks';
import type { FactsInput } from '../../../../frontend/app/src/data/selectors/facts';
import { listEmployees } from '../people/employees.service';
import { EmployeeFilter } from '../people/employees.schema';
import { getAttendance, getHolidays } from '../people/attendance.service';
import { getLeaveRequests, getLeaveTypes, LeaveQuery } from '../people/leave.service';
import { listApprovals } from '../../engines/approvals/engine';
import { EntryFilter, listEntries } from '../work/timesheets.service';
import { InvoiceFilter, listInvoices } from '../finance/invoices.service';
import { ExpenseFilter, listExpenses } from '../finance/expenses.service';
import { listClients } from '../work/clients.service';
import { listProjects, ProjectFilter } from '../work/projects.service';
import { listTasks, TaskFilter } from '../work/tasks.service';
import { getAllSalaryEvents, listRuns } from '../people/payroll.service';
import { listLeads } from '../clients/leads.service';
import { listContracts } from '../clients/contracts.service';
import { listTickets } from '../clients/tickets.service';
import { listAssets } from '../workplace/assets.service';
import { listInventory } from '../workplace/inventory.service';
import { listBookings } from '../workplace/rooms.service';
import { listVisitors } from '../workplace/visitors.service';
import { listUsers } from '../admin/users.service';
import { listWorkflows } from '../admin/workflows.service';
import { listAudit } from '../admin/audit-read.service';
import { listSystemJobs } from '../admin/system-jobs.service';
import { listCandidates, listJobs } from '../people/recruitment.service';
import { listOnboarding } from '../people/onboarding.service';
import { listReviews } from '../people/performance.service';
import { listCertifications } from '../people/training.service';
import { listAnnouncements } from '../workplace/announcements.service';
import { listKb } from '../workplace/kb.service';
import { listBudgets } from '../finance/budgets.service';

export const FactsQuery = z.object({ role: z.enum(['Admin', 'HR', 'Manager', 'Employee']).optional() });
export const BlocksQuery = z.object({
  metric: z.coerce.number().int().min(0).max(10).default(0),
  range: z.coerce.number().refine((r) => (RANGES as readonly number[]).includes(r), 'Choose 13, 26 or 52 weeks.').default(26),
  colour: z.enum(['Violet', 'Ember', 'Mono']).default('Violet'),
});

/** A list the person may not see is empty, as it is on their screens. */
async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch (e) {
    if (isApiError(e) && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
}

/** The role the dashboard is for: always the signed-in account's (a `?role` that differs is refused). */
function roleOf(actor: Actor, asked?: Role): Exclude<Role, 'Client'> {
  if (actor.role === 'Client' || !actor.employeeId) throw forbidden('Dashboards are for staff accounts.');
  if (asked && asked !== actor.role) throw forbidden('You can only see your own dashboard.');
  return actor.role;
}

async function inputFor(actor: Actor): Promise<FactsInput> {
  const t = today();
  const org = await db.selectFrom('org').select('historyFrom').executeTakeFirst();
  const page = { pageSize: 1000 };
  const [
    employees, attendance, leave, leaveTypes, holidays, approvals, entries, invoices, expenses, clients, projects, tasks, salaryEvents,
    leads, contracts, tickets, assets, inventory, bookings, visitors, users, workflows, audit, systemJobs, payrollRuns, jobs, candidates,
    onboarding, reviews, certifications, announcements, kb, budgets,
  ] = await Promise.all([
    safe(listEmployees(actor, parse(EmployeeFilter, page)).then((p) => p.items)),
    safe(getAttendance(actor, { from: org?.historyFrom ?? t, to: t })),
    safe(getLeaveRequests(actor, parse(LeaveQuery, {}))),
    getLeaveTypes(),
    getHolidays(),
    safe(listApprovals(actor, {})),
    safe(listEntries(actor, parse(EntryFilter, {}))),
    safe(listInvoices(actor, parse(InvoiceFilter, page)).then((p) => p.items)),
    safe(listExpenses(actor, parse(ExpenseFilter, page)).then((p) => p.items)),
    safe(listClients(actor)),
    safe(listProjects(actor, parse(ProjectFilter, page)).then((p) => p.items)),
    safe(listTasks(actor, parse(TaskFilter, {}))),
    safe(getAllSalaryEvents(actor)),
    safe(listLeads(actor)),
    safe(listContracts(actor)),
    safe(listTickets(actor)),
    safe(listAssets(actor)),
    safe(listInventory(actor)),
    safe(listBookings(actor, t)),
    safe(listVisitors(actor)),
    safe(listUsers(actor)),
    safe(listWorkflows(actor)),
    safe(listAudit(actor, { pageSize: 500 }).then((p) => p.items)),
    safe(listSystemJobs(actor)),
    safe(listRuns(actor)),
    safe(listJobs(actor)),
    safe(listCandidates(actor)),
    safe(listOnboarding(actor)),
    safe(listReviews(actor, {})),
    safe(listCertifications(actor)),
    safe(listAnnouncements(actor)),
    safe(listKb(actor)),
    safe(listBudgets(actor)),
  ]);
  return {
    today: t, now: nowZoned(), meId: actor.employeeId!,
    employees, attendance, leave, leaveTypes, holidays, approvals, entries, invoices, expenses, clients, projects, tasks, salaryEvents,
    leads, contracts, tickets, assets, inventory, bookings, visitors, users, workflows, audit, systemJobs,
    // The figures read runs oldest first (the API lists them newest first).
    payrollRuns: [...payrollRuns].reverse(),
    jobs, candidates, onboarding, reviews, certifications, announcements, kb, budgets,
  };
}

/** GET /dashboard-facts?role */
export async function getDashboardFacts(actor: Actor, q: z.infer<typeof FactsQuery>): Promise<DashboardFacts> {
  const role = roleOf(actor, q.role);
  const input = await inputFor(actor);
  return dashboardFacts(input, role, input.now!);
}

/** GET /dashboard-blocks?metric&range&colour */
export async function getDashboardBlocks(actor: Actor, q: z.infer<typeof BlocksQuery>): Promise<BlockModel> {
  const role = roleOf(actor);
  const input = await inputFor(actor);
  return buildBlocks({ ...input, role }, q.metric, q.range as (typeof RANGES)[number], q.colour);
}
