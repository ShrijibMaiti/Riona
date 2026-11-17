/**
 * Hub structure (labels, routes, copy). Every figure is a function of computed Facts — none is typed in.
 */
import { hours, inr, lakh, pct } from '../lib/format';
import type { Facts } from '../data/selectors/facts';
import type { Role } from '../data/types';

export type Trend = 'up' | 'down' | 'warn' | 'flat';
export type MetricDef = { label: string; value: (f: Facts) => string; delta: (f: Facts) => string; trend: Trend | ((f: Facts) => Trend); href: string; estimated?: string };
export type ModuleDef = { name: string; tagline: string; summary: string; live: (f: Facts) => string; href: string; roles?: Role[] };
export type HubDef = { key: string; label: string; path: string; desc: string; metrics: MetricDef[]; modules: ModuleDef[] };

const m = (label: string, value: MetricDef['value'], delta: MetricDef['delta'], trend: MetricDef['trend'], href: string, estimated?: string): MetricDef => ({ label, value, delta, trend, href, estimated });
const mod = (name: string, tagline: string, summary: string, live: ModuleDef['live'], href: string, roles?: Role[]): ModuleDef => ({ name, tagline, summary, live, href, roles });
const n = (x: number, one: string, many = one + 's') => x + ' ' + (x === 1 ? one : many);

export const HUBS: Record<string, HubDef> = {
  people: {
    key: 'people', label: 'People', path: '/app/people', desc: 'Everyone who works here — their time, pay, growth and paperwork.',
    metrics: [
      m('Headcount', (f) => String(f.people.headcount), (f) => (f.people.joinedThisMonth ? '+' + f.people.joinedThisMonth + ' joined this month' : 'No joiners this month'), (f) => (f.people.joinedThisMonth ? 'up' : 'flat'), '/app/people/directory'),
      m('Present today', (f) => String(f.people.present), (f) => 'of ' + f.people.scheduled + ' scheduled', 'flat', '/app/people/attendance'),
      m('On leave today', (f) => String(f.people.onLeave), (f) => f.people.leaveDelta, (f) => (f.people.onLeave > f.people.usualLeave ? 'warn' : 'flat'), '/app/people/leave/calendar'),
      m('Open positions', (f) => String(f.people.openPositions), (f) => 'Across ' + n(f.people.openRoles, 'job') + ' · ' + n(f.people.applicants, 'applicant'), 'flat', '/app/people/recruitment'),
    ],
    modules: [
      mod('Directory', 'Every employee, one place', 'Profiles, reporting lines and documents for everyone.', (f) => n(f.people.headcount, 'person', 'people') + ' · ' + f.people.joinedThisMonth + ' joined this month', '/app/people/directory'),
      mod('Attendance', 'Daily marks and corrections', 'Today’s log, the monthly register and regularisation requests.', (f) => n(f.people.regularisation, 'regularisation request'), '/app/people/attendance'),
      mod('Leave', 'Requests, balances, team calendar', 'Approvals, balances, policies and who is away when.', (f) => n(f.people.leavePending, 'pending approval'), '/app/people/leave'),
      mod('Payroll', 'Runs, structures, statutory filings', 'Monthly runs with PF, ESI, PT and TDS computed in.', (f) => f.people.payrollMonth + ' run · ' + f.people.payrollStage, '/app/people/payroll', ['Admin', 'HR']),
      mod('Onboarding', 'Joiners and leavers, checklisted', 'Checklists for HR, IT, managers and finance.', (f) => f.people.joining30 + ' joining in the next 30 days', '/app/people/onboarding'),
      mod('Performance', 'Cycles, goals, honest reviews', 'Review cycles, goals and calibration.', (f) => 'H2 cycle · ' + f.people.selfIn + '% self-reviews in', '/app/people/performance'),
      mod('Recruitment', 'Openings, pipeline and interviews', 'Jobs, candidates and interview loops.', (f) => n(f.people.openPositions, 'opening') + ' across ' + n(f.people.openRoles, 'job'), '/app/people/recruitment'),
      mod('Training', 'Programmes and expiring certifications', 'Programmes, and the certifications that lapse.', (f) => (f.people.expiringCerts - f.people.certsLapsed) + ' expiring · ' + f.people.certsLapsed + ' lapsed', '/app/people/training'),
    ],
  },
  work: {
    key: 'work', label: 'Work', path: '/app/work', desc: 'Projects, the hours that go into them, and the dates that matter.',
    metrics: [
      m('Active projects', (f) => String(f.work.activeProjects), (f) => f.work.atRisk + ' at risk or off track', (f) => (f.work.atRisk ? 'warn' : 'flat'), '/app/work/projects'),
      m('Hours logged this week', (f) => hours(f.work.weekHours), (f) => f.work.capacityPct + '% of capacity so far', 'flat', '/app/work/timesheets'),
      m('Overdue tasks', (f) => String(f.work.overdue), (f) => f.work.dueThisWeek + ' more due this week', (f) => (f.work.overdue ? 'down' : 'flat'), '/app/me/tasks'),
      m('Unbilled hours', (f) => hours(f.work.unbilledHours), (f) => lakh(f.work.unbilledValue) + ' ready to invoice', 'warn', '/app/finance/invoices/new'),
    ],
    modules: [
      mod('Projects', 'Boards, timelines, budgets, teams', 'Every engagement with its board, plan, budget and team.', (f) => f.work.activeProjects + ' active · ' + f.work.atRisk + ' at risk', '/app/work/projects'),
      mod('Timesheets', 'Hours that become invoices', 'The weekly grid where cost, billing and margin begin.', (f) => n(f.work.timesheetPending, 'week') + ' awaiting approval', '/app/work/timesheets'),
      mod('Calendar', 'Every date, layered together', 'Holidays, leave, deadlines and bookings in one view.', (f) => (f.work.nextHoliday ? f.work.nextHoliday.name + ' · ' + f.work.nextHoliday.date.slice(8).replace(/^0/, '') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+f.work.nextHoliday.date.slice(5, 7) - 1] : 'No holidays ahead'), '/app/work/calendar'),
    ],
  },
  clients: {
    key: 'clients', label: 'Clients', path: '/app/clients', desc: 'The people you work for — from first conversation to renewal.',
    metrics: [
      m('Active clients', (f) => String(f.clients.active), (f) => f.clients.clientsOwing + ' with balances due', 'flat', '/app/clients/accounts'),
      m('Pipeline value', (f) => lakh(f.clients.pipeline), (f) => n(f.clients.openDeals, 'deal') + ' in play', 'flat', '/app/clients/leads'),
      m('Contracts expiring in 60 days', (f) => String(f.clients.expiring), (f) => (f.clients.nextExpiry ? f.clients.nextExpiryClient + ' first, ' + f.clients.nextExpiry.end.slice(8) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+f.clients.nextExpiry.end.slice(5, 7) - 1] : 'None'), (f) => (f.clients.expiring ? 'warn' : 'flat'), '/app/clients/contracts'),
      m('Open tickets', (f) => String(f.clients.openTickets), (f) => f.clients.breached + ' past SLA', (f) => (f.clients.breached ? 'down' : 'flat'), '/app/clients/tickets'),
    ],
    modules: [
      mod('Accounts', 'Every client relationship, complete', 'Contacts, activity, projects, documents and invoices.', (f) => f.clients.active + ' active · ' + lakh(f.clients.outstanding) + ' outstanding', '/app/clients/accounts'),
      mod('Leads', 'Pipeline from hello onward', 'Deals by stage with days-in-stage and value.', (f) => n(f.clients.openDeals, 'open deal') + ' · ' + lakh(f.clients.pipeline), '/app/clients/leads'),
      mod('Contracts', 'Terms, renewals and SLAs', 'Agreements, expiries and the SLAs tickets run against.', (f) => f.clients.expiring + ' expiring in 60 days', '/app/clients/contracts'),
      mod('Tickets', 'Support against SLA clocks', 'Client issues with response and resolution timers.', (f) => f.clients.openTickets + ' open · ' + f.clients.breached + ' breached', '/app/clients/tickets'),
    ],
  },
  finance: {
    key: 'finance', label: 'Finance', path: '/app/finance', desc: 'Money in, money out, and what each hour of work actually earned.',
    metrics: [
      m('Invoiced this month', (f) => lakh(f.finance.revenue), (f) => (f.finance.revDelta >= 0 ? '+' : '−') + Math.abs(f.finance.revDelta).toFixed(1) + '% vs same days of ' + f.finance.revenuePrevLabel, (f) => (f.finance.revDelta >= 0 ? 'up' : 'down'), '/app/finance/invoices'),
      m('Outstanding receivables', (f) => lakh(f.finance.outstanding), (f) => lakh(f.finance.over60) + ' over 60 days', 'warn', '/app/finance/invoices'),
      m('Expenses pending approval', (f) => String(f.finance.expensesPending), (f) => inr(f.finance.expensesPendingAmount) + ' in total', 'flat', '/app/finance/expenses'),
      m('Blended margin', (f) => pct(f.finance.margin), () => 'Since May, from logged hours', 'flat', '/app/finance/profitability', 'Labour cost uses estimated cost rates (CTC × 1.4 ÷ 12 ÷ 140 h).'),
    ],
    modules: [
      mod('Invoices', 'Billed from logged work', 'Invoices assembled from approved timesheets and billable expenses.', (f) => lakh(f.finance.unbilledValue) + ' of approved time unbilled', '/app/finance/invoices'),
      mod('Expenses', 'Claims, receipts, approvals', 'Claims with receipts, routed through approval.', (f) => n(f.finance.expensesPending, 'claim') + ' pending', '/app/finance/expenses'),
      mod('Budget', 'Planned against actual spend', 'Department budgets with committed and actual spend.', (f) => (f.finance.topBudget ? f.finance.topBudget.dept + ' at ' + f.finance.topBudget.pct + '% of budget' : '—'), '/app/finance/budget'),
      mod('Profitability', 'Margin, traced to hours', 'Margin by client, project and person — every figure traceable.', (f) => (f.finance.worstClient ? f.finance.worstClient.name + ' running at ' + pct(f.finance.worstClient.pct) : '—'), '/app/finance/profitability'),
    ],
  },
  workplace: {
    key: 'workplace', label: 'Workplace', path: '/app/workplace', desc: 'The office itself — equipment, space, news and the people walking in.',
    metrics: [
      m('Assets allocated', (f) => String(f.workplace.allocated), (f) => 'of ' + f.workplace.tracked + ' tracked', 'flat', '/app/workplace/assets'),
      m('Items below reorder level', (f) => String(f.workplace.low.length), (f) => f.workplace.low.slice(0, 3).join(', ') || 'All stocked', (f) => (f.workplace.low.length ? 'down' : 'flat'), '/app/workplace/inventory'),
      m('Rooms in use now', (f) => f.workplace.roomsNow + ' of ' + f.workplace.rooms, (f) => 'Peak at ' + f.workplace.peakHour, 'flat', '/app/workplace/rooms'),
      m('Visitors today', (f) => String(f.workplace.visitorsToday), (f) => f.workplace.onSite + ' on site now', 'flat', '/app/workplace/visitors'),
    ],
    modules: [
      mod('Assets', 'Laptops, licences, furniture', 'Every tracked item and who holds it.', (f) => f.workplace.available + ' available · ' + f.workplace.repair + ' under repair', '/app/workplace/assets'),
      mod('Inventory', 'Consumables and reorder levels', 'Stock in, stock out, and what is running low.', (f) => f.workplace.low.length + ' below reorder level', '/app/workplace/inventory'),
      mod('Rooms', 'Book space without clashes', 'A day view of every room, bookable by the span.', (f) => f.workplace.roomsNow + ' of ' + f.workplace.rooms + ' in use now', '/app/workplace/rooms'),
      mod('Announcements', 'Company news, acknowledged', 'Posts with audiences, pins and read receipts.', (f) => f.workplace.pinnedTitle + ' · ' + f.workplace.ackPct + '% acknowledged', '/app/workplace/announcements'),
      mod('Knowledge base', 'Policies and how-tos', 'Policies, SOPs and how-tos, written to be read.', (f) => n(f.workplace.kbThisWeek, 'article') + ' updated this week', '/app/workplace/kb'),
      mod('Visitors', 'Front desk, pre-registered', 'Who is coming in, who is on site, who they are seeing.', (f) => f.workplace.visitorsToday + ' today · ' + f.workplace.onSite + ' on site', '/app/workplace/visitors'),
    ],
  },
  admin: {
    key: 'admin', label: 'Admin', path: '/app/admin', desc: 'Who can do what, how requests flow, and the record of everything that happened.',
    metrics: [
      m('Users', (f) => String(f.admin.users), (f) => n(f.admin.invited, 'invite') + ' pending', 'flat', '/app/admin/users'),
      m('Active workflows', (f) => String(f.admin.activeWf), (f) => 'of ' + f.admin.workflows + ' configured', 'flat', '/app/admin/workflows'),
      m('Audit events today', (f) => f.admin.auditToday.toLocaleString('en-IN'), () => 'Read-only, kept permanently', 'flat', '/app/admin/audit'),
      m('Failed jobs', (f) => String(f.admin.failed.length), (f) => f.admin.failed.map((j) => j.name).join(', ') || 'All healthy', (f) => (f.admin.failed.length ? 'down' : 'flat'), '/app/admin/notifications'),
    ],
    modules: [
      mod('Users', 'Accounts, invites, access', 'Invite, deactivate, reset and change roles.', (f) => f.admin.users + ' users · ' + f.admin.invited + ' invited', '/app/admin/users'),
      mod('Roles & permissions', 'Who can do what', 'Permission matrices for seeded and custom roles.', () => 'Seeded and custom roles', '/app/admin/roles'),
      mod('Approval workflows', 'How requests get decided', 'The engine every approval in Riona runs on.', (f) => f.admin.activeWf + ' active · ' + f.admin.paused + ' paused', '/app/admin/workflows'),
      mod('Notification rules', 'Who hears about what', 'Events by channel. In-app delivery works today; email and digest rules are recorded for later.', () => 'In-app today · email and digest coming', '/app/admin/notifications'),
      mod('Audit log', 'Everything, permanently recorded', 'Read-only. Nothing here can be deleted.', (f) => f.admin.auditToday + ' events today', '/app/admin/audit'),
      mod('Masters', 'Reference data for everything', 'Departments, locations, leave types, tax slabs.', () => 'Reference lists', '/app/admin/masters'),
    ],
  },
  me: {
    key: 'me', label: 'My Space', path: '/app/me', desc: 'Your pay, your time, your things — nobody else’s.',
    metrics: [
      m('Leave balance', (f) => f.mine.balance + ' days', (f) => f.mine.balances.filter((b) => b.code !== 'CO').map((b) => b.name.split(' ')[0] + ' ' + b.available).join(' · '), 'flat', '/app/me/leave'),
      m('Hours this week', (f) => hours(f.mine.hours), () => 'Expected 40 h', 'flat', '/app/work/timesheets'),
      m('Pending claims', (f) => inr(f.mine.pendingClaims), (f) => (f.mine.pendingClaimsCount ? n(f.mine.pendingClaimsCount, 'claim') + ' not yet paid' : 'Nothing outstanding'), 'flat', '/app/me/expenses'),
      m('Assets held', (f) => String(f.mine.assets.length), (f) => f.mine.assets.join(', ') || 'None', 'flat', '/app/me/assets'),
    ],
    modules: [
      mod('My payslips', 'Every month, itemised', 'Payslips with the statutory breakdown and Form 16.', (f) => f.mine.lastPayslip + ' published', '/app/me/payslips'),
      mod('My leave', 'Balances and requests', 'Apply, track and see who approved.', (f) => n(f.mine.leavePending, 'request') + ' pending', '/app/me/leave'),
      mod('My attendance', 'Your marks, your corrections', 'Your month, with regularisation on any irregular day.', (f) => 'On time ' + f.mine.onTime + ' of ' + f.mine.attDays + ' days', '/app/me/attendance'),
      mod('My expenses', 'Claims and reimbursements', 'Submit receipts and follow them to payout.', (f) => (f.mine.pendingClaimsCount ? n(f.mine.pendingClaimsCount, 'claim') + ' in progress' : 'Nothing waiting to be paid'), '/app/me/expenses'),
      mod('My tasks', 'Across every project', 'Everything assigned to you, by when it is due.', (f) => f.mine.tasksOverdue + ' overdue · ' + f.mine.tasksThisWeek + ' due this week', '/app/me/tasks'),
      mod('My assets', 'Things you are holding', 'Allocated items and a way to report issues.', (f) => n(f.mine.assets.length, 'item'), '/app/me/assets'),
      mod('Profile', 'Your details, kept current', 'Personal details — some changes route via HR.', () => 'Some fields need HR approval', '/app/me/profile'),
    ],
  },
  leave: {
    key: 'leave', label: 'Leave', path: '/app/people/leave', desc: 'Requests, balances, the team calendar and the rules behind them.',
    metrics: [
      m('Pending requests', (f) => String(f.people.leavePending), () => 'Waiting on an approver', 'warn', '/app/people/leave/requests'),
      m('On leave today', (f) => String(f.people.onLeave), (f) => f.people.leaveDelta, 'flat', '/app/people/leave/calendar'),
      m('Away next week', (f) => String(f.people.awayNextWeek), (f) => (f.people.peakDelivery.pct ? 'Delivery peaks at ' + f.people.peakDelivery.pct + '% away' : 'Delivery fully staffed'), (f) => (f.people.peakDelivery.pct >= 40 ? 'warn' : 'flat'), '/app/people/leave/calendar'),
    ],
    modules: [
      mod('Requests', 'Approve and track', 'The approval queue, by pending, approved and rejected.', (f) => f.people.leavePending + ' pending', '/app/people/leave/requests'),
      mod('Calendar', 'Who is away when', 'Month view with holidays and team thresholds.', (f) => 'Delivery peaks at ' + f.people.peakDelivery.pct + '% away', '/app/people/leave/calendar'),
      mod('Balances', 'Opening to closing', 'Employee × leave type with accruals and usage.', (f) => f.people.headcount + ' employees · 4 accruing types', '/app/people/leave/balances'),
      mod('Policies', 'Accrual and carry-forward', 'Leave types and the rules that govern them.', () => 'Six leave types', '/app/people/leave/policies'),
    ],
  },
};

export type NavKey = 'dashboard' | 'me' | 'people' | 'work' | 'clients' | 'finance' | 'workplace' | 'admin';
export const NAV_KEYS: NavKey[] = ['dashboard', 'people', 'work', 'clients', 'finance', 'workplace', 'admin'];
/** One top bar per role. Admin sits with the hubs (not only in the account menu); employees start at My Space. */
export const ROLE_NAV: Record<Role, NavKey[]> = {
  Admin: NAV_KEYS,
  HR: ['dashboard', 'people', 'work', 'workplace'],
  Manager: ['dashboard', 'people', 'work', 'clients', 'workplace'],
  Employee: ['me', 'dashboard', 'work', 'workplace'],
};
export const ROLES: Role[] = ['Admin', 'HR', 'Manager', 'Employee'];

/** Breadcrumb labels for path segments. */
export const LABELS: Record<string, string> = {
  people: 'People', work: 'Work', clients: 'Clients', finance: 'Finance', workplace: 'Workplace', admin: 'Admin', me: 'My Space', approvals: 'Approvals',
  directory: 'Directory', 'org-chart': 'Org chart', attendance: 'Attendance', regularisation: 'Regularisation', leave: 'Leave', requests: 'Requests',
  calendar: 'Calendar', balances: 'Balances', policies: 'Policies', payroll: 'Payroll', runs: 'Runs', structures: 'Salary structures', statutory: 'Statutory',
  onboarding: 'Onboarding', performance: 'Performance', cycles: 'Cycles', recruitment: 'Recruitment', jobs: 'Jobs', candidates: 'Candidates',
  training: 'Training', programmes: 'Programmes', projects: 'Projects', timesheets: 'Timesheets', accounts: 'Accounts', leads: 'Leads', board: 'Board',
  contracts: 'Contracts', tickets: 'Tickets', invoices: 'Invoices', new: 'New', expenses: 'Expenses', budget: 'Budget', profitability: 'Profitability',
  assets: 'Assets', inventory: 'Inventory', rooms: 'Rooms', announcements: 'Announcements', kb: 'Knowledge base', visitors: 'Visitors', users: 'Users',
  invite: 'Invite', roles: 'Roles & permissions', workflows: 'Approval workflows', notifications: 'Notification rules', audit: 'Audit log', masters: 'Masters',
  payslips: 'My payslips', tasks: 'My tasks', profile: 'Profile', overview: 'Overview', job: 'Job', compensation: 'Compensation', documents: 'Documents',
  list: 'List', timeline: 'Timeline', files: 'Files', team: 'Team', task: 'Task', entries: 'Entries', submit: 'Submit claim', kiosk: 'Kiosk', reviews: 'Review',
};
