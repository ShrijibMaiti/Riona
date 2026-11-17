/**
 * The demo organisation (Kestrel Digital). Deterministic: the same code always produces the same data.
 * Loaded into Postgres by ../import-fixture.ts (npm run db:seed). Until Wave 9 it lived in the frontend as its
 * in-memory fixture; the backend owns it now.
 */
import type * as T from '@riona/shared';
import { seedApprovals, seedNotifications } from './approvals';
import { HOLIDAYS, TODAY } from './calendar';
import {
  CYCLES, PROGRAMMES, ROOMS, seedAnnouncements, seedAssets, seedAudit, seedBookings, seedCandidates, seedCertifications, seedContracts,
  seedDocuments, seedInventory, seedJobs, seedKb, seedLeads, seedMasters, seedNotificationRules, seedOnboarding, seedReviews, seedRoles,
  seedSystemJobs, seedTickets, seedUsers, seedVisitors, seedWorkflows,
} from './extra';
import { seedBudgets, seedExpenses, seedInvoices } from './finance';
import { LEAVE_TYPES, ME_ID, STRUCTURES, seedAttendance, seedEmployees, seedFilings, seedLeave, seedPayrollRuns, seedSalaryEvents } from './people';
import { seedClients, seedEntries, seedProjects, seedTasks, seedWeeks } from './work';

export type Db = {
  today: string;
  meId: string;
  employees: T.Employee[];
  salaryEvents: T.SalaryEvent[];
  leaveTypes: T.LeaveType[];
  leave: T.LeaveRequest[];
  attendance: T.AttendanceDay[];
  holidays: T.Holiday[];
  regularisations: T.RegularisationRequest[];
  profileChanges: T.ProfileChange[];
  payrollRuns: T.PayrollRun[];
  structures: T.SalaryStructure[];
  filings: T.StatutoryFiling[];
  jobs: T.Job[];
  candidates: T.Candidate[];
  onboarding: T.OnboardingCase[];
  cycles: T.ReviewCycle[];
  reviews: T.Review[];
  goals: T.Goal[];
  programmes: T.TrainingProgramme[];
  certifications: T.Certification[];
  clients: T.Client[];
  projects: T.Project[];
  tasks: T.Task[];
  entries: T.TimesheetEntry[];
  weeks: T.TimesheetWeek[];
  invoices: T.Invoice[];
  expenses: T.ExpenseClaim[];
  budgets: T.Budget[];
  leads: T.Lead[];
  contracts: T.Contract[];
  tickets: T.Ticket[];
  assets: T.Asset[];
  inventory: T.InventoryItem[];
  rooms: T.Room[];
  bookings: T.Booking[];
  announcements: T.Announcement[];
  kb: T.KbArticle[];
  visitors: T.Visitor[];
  approvals: T.Approval[];
  notifications: T.Notification[];
  users: T.AppUser[];
  roles: T.RoleDef[];
  workflows: T.Workflow[];
  notificationRules: T.NotificationRule[];
  audit: T.AuditEvent[];
  masters: T.MasterList[];
  systemJobs: T.SystemJob[];
  documents: T.Document[];
};

export function createSeed(): Db {
  const employees = seedEmployees();
  const salaryEvents = seedSalaryEvents(employees);
  const leave = seedLeave(employees);
  const attendance = seedAttendance(employees, leave);
  const clients = seedClients();
  const projects = seedProjects(employees);
  const tasks = seedTasks(projects);
  const entries = seedEntries(employees, projects, tasks, attendance);
  const weeks = seedWeeks(entries);
  const expenses = seedExpenses(employees, projects);
  const invoices = seedInvoices(clients, projects, employees, entries, expenses);
  const { approvals, regs } = seedApprovals({ emps: employees, leave, expenses, weeks, entries, invoices, projects });
  const jobs = seedJobs();
  const { reviews, goals } = seedReviews(employees);
  // One self-service change waiting on HR, so My Space shows the pending state.
  const me = employees.find((e) => e.id === ME_ID)!;
  const profileChanges: T.ProfileChange[] = [{ id: 'PC-1', employeeId: ME_ID, field: 'Address', before: me.address, after: '41, 6th Cross, Indiranagar 2nd Stage, Bengaluru 560038', reason: 'Moved house in October', submitted: '2026-11-04', status: 'Pending', approvalId: 'AP-PC1' }];
  approvals.push({ id: 'AP-PC1', type: 'Profile change', sourceId: 'PC-1', requesterId: ME_ID, submitted: '2026-11-04', status: 'Pending', current: 1,
    chain: [{ approverId: ME_ID, role: 'Requester', decision: 'Approved', at: '2026-11-04', comment: null }, { approverId: 'E-0101', role: 'HR', decision: null, at: null, comment: null }] });
  return {
    today: TODAY,
    meId: ME_ID,
    employees,
    salaryEvents,
    leaveTypes: LEAVE_TYPES,
    leave,
    attendance,
    holidays: HOLIDAYS,
    regularisations: regs,
    profileChanges,
    payrollRuns: seedPayrollRuns(employees, salaryEvents),
    structures: STRUCTURES,
    filings: seedFilings(),
    jobs,
    candidates: seedCandidates(jobs, employees),
    onboarding: seedOnboarding(),
    cycles: CYCLES,
    reviews,
    goals,
    programmes: PROGRAMMES,
    certifications: seedCertifications(employees),
    clients,
    projects,
    tasks,
    entries,
    weeks,
    invoices,
    expenses,
    budgets: seedBudgets(),
    leads: seedLeads(),
    contracts: seedContracts(clients),
    tickets: seedTickets(clients, projects),
    assets: seedAssets(employees),
    inventory: seedInventory(),
    rooms: ROOMS,
    bookings: seedBookings(employees),
    announcements: seedAnnouncements(employees),
    kb: seedKb(),
    visitors: seedVisitors(employees),
    approvals,
    notifications: seedNotifications(approvals),
    users: seedUsers(employees),
    roles: seedRoles(),
    workflows: seedWorkflows(),
    notificationRules: seedNotificationRules(),
    audit: seedAudit(employees),
    masters: seedMasters(),
    systemJobs: seedSystemJobs(),
    documents: seedDocuments(employees, projects, clients),
  };
}
