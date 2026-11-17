/**
 * The API contract as functions: every repository function the screens call, with its arguments and result.
 * ./http implements each one as a request (./http/endpoints.ts says which). Until Wave 9 these signatures were
 * taken from the in-memory fixture; it is gone, and this file is the contract.
 */
import type {
  Announcement, AppUser, ApprovalFilter, ApprovalWithSource, Asset, AttendanceDay, AttendanceFilter, AuditEvent, AuditFilter, Booking, Budget, Candidate, CandidateStage, Certification, Client, Contract, Document, Employee, EmployeeFilter, ExpenseClaim, ExpenseFilter, Goal, Holiday, InventoryItem, Invoice, InvoiceFilter, InvoiceLine, Job, KbArticle, Lead, LeadStage, LeaveFilter, LeaveRequest, LeaveType, LeaveTypeCode, MasterList, NewExpenseInput, NewInvoiceInput, Notification, NotificationRule, OnboardingCase, Paginated, PayrollRun, Permission, PortalDocument, PortalInvoice, PortalProject, PortalSession, PortalTicket, ProfileChange, ProfileChangeField, Project, ProjectFilter, RegularisationRequest, Review, ReviewCycle, Role, RoleDef, Room, SalaryEvent, SalaryStructure, StatutoryFiling, SystemJob, Task, TaskFilter, Ticket, TimesheetEntry, TimesheetFilter, TimesheetWeek, TrainingProgramme, UploadedFile, Visitor, Workflow,
} from '../types';
export type { PortalDocument, PortalInvoice, PortalProject, PortalSession, PortalTicket } from '../types';
import type { BlockColour, BlockModel, Range } from '../selectors/blocks';
import type { DashboardFacts } from '../selectors/dashboard';

// ---------------- people ----------------
/** GET /employees?search&dept&location&status&managerId&type&page&pageSize&sort&dir */
export declare function getEmployees(filter?: EmployeeFilter): Promise<Paginated<Employee>>;
/** GET /employees/:id */
export declare function getEmployee(id: string): Promise<Employee>;
/** PATCH /employees/:id */
export declare function updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee>;
/** POST /employees/:id/bank/reveal — returns the full account number and writes an audit event. */
export declare function revealBankAccount(id: string): Promise<{
    account: string;
}>;
/** GET /employees/:id/salary-events — append-only. */
export declare function getSalaryEvents(employeeId: string): Promise<SalaryEvent[]>;
/** GET /salary-events?employeeIds — every ledger, for cost rates (restricted to Finance/Admin). */
export declare function getAllSalaryEvents(): Promise<SalaryEvent[]>;
/** POST /employees/:id/salary-events */
export declare function appendSalaryEvent(ev: Omit<SalaryEvent, 'id' | 'recorded' | 'actorId'>): Promise<SalaryEvent>;
/** GET /attendance?employeeId&from&to */
export declare function getAttendance(filter: AttendanceFilter): Promise<AttendanceDay[]>;
/** GET /holidays */
export declare function getHolidays(): Promise<Holiday[]>;
/** GET /regularisations?employeeId */
export declare function getRegularisations(filter?: {
    employeeId?: string;
}): Promise<RegularisationRequest[]>;
/** POST /regularisations */
export declare function requestRegularisation(input: Pick<RegularisationRequest, 'date' | 'requestedMark' | 'requestedIn' | 'requestedOut' | 'reason'>): Promise<RegularisationRequest>;
/** GET /leave-types */
export declare function getLeaveTypes(): Promise<LeaveType[]>;
/** GET /leave-requests?employeeId&status&from&to */
export declare function getLeaveRequests(filter?: LeaveFilter): Promise<LeaveRequest[]>;
/** POST /leave-requests */
export declare function applyLeave(input: {
    type: LeaveTypeCode;
    from: string;
    to: string;
    reason: string;
    days: number;
}): Promise<LeaveRequest>;
/** POST /leave-requests/:id/cancel */
export declare function cancelLeave(id: string): Promise<LeaveRequest>;
/** GET /payroll-runs */
export declare function getPayrollRuns(): Promise<PayrollRun[]>;
/** GET /payroll-runs/:id */
export declare function getPayrollRun(id: string): Promise<PayrollRun>;
/** POST /payroll-runs/:id/advance — moves to the next stage. */
export declare function advancePayrollRun(id: string): Promise<PayrollRun>;
/** GET /salary-structures */
export declare function getSalaryStructures(): Promise<SalaryStructure[]>;
/** PUT /salary-structures/:id */
export declare function saveSalaryStructure(s: SalaryStructure): Promise<SalaryStructure>;
/** GET /statutory-filings */
export declare function getFilings(): Promise<StatutoryFiling[]>;
/** GET /jobs */
export declare function getJobs(): Promise<Job[]>;
/** GET /jobs/:id */
export declare function getJob(id: string): Promise<Job>;
/** GET /candidates?jobId */
export declare function getCandidates(jobId?: string): Promise<Candidate[]>;
/** GET /candidates/:id */
export declare function getCandidate(id: string): Promise<Candidate>;
/** PATCH /candidates/:id { stage } */
export declare function moveCandidate(id: string, stage: CandidateStage): Promise<Candidate>;
/** GET /onboarding */
export declare function getOnboarding(): Promise<OnboardingCase[]>;
/** GET /onboarding/:id */
export declare function getOnboardingCase(id: string): Promise<OnboardingCase>;
/** PATCH /onboarding/:id/items/:itemId { done } */
export declare function setChecklistItem(caseId: string, itemId: string, done: boolean): Promise<OnboardingCase>;
/** GET /review-cycles */
export declare function getReviewCycles(): Promise<ReviewCycle[]>;
/** GET /reviews?cycleId&employeeId */
export declare function getReviews(filter?: {
    cycleId?: string;
    employeeId?: string;
}): Promise<Review[]>;
/** GET /reviews/:id */
export declare function getReview(id: string): Promise<Review>;
/** PUT /reviews/:id */
export declare function saveReview(id: string, patch: Pick<Review, 'selfAnswers' | 'managerAnswers' | 'rating' | 'status'>): Promise<Review>;
/** GET /goals?employeeId */
export declare function getGoals(employeeId?: string): Promise<Goal[]>;
/** GET /training/programmes */
export declare function getProgrammes(): Promise<TrainingProgramme[]>;
/** GET /training/certifications?employeeId */
export declare function getCertifications(employeeId?: string): Promise<Certification[]>;
export type NewEmployeeInput = Pick<Employee, 'name' | 'email' | 'title' | 'dept' | 'managerId' | 'location' | 'type' | 'joined' | 'phone' | 'billable' | 'billRate'> & {
    ctc: number;
};
/** POST /employees — creates the record, the hiring salary event and a joining checklist. */
export declare function createEmployee(input: NewEmployeeInput): Promise<Employee>;
/** Fields the employee may change directly; everything else on the profile is HR-maintained or HR-approved. */
export type SelfServicePatch = Partial<Pick<Employee, 'phone' | 'personalEmail' | 'bloodGroup'>> & {
    emergency?: Employee['emergency'];
};
/** PATCH /me/profile — self-service fields apply immediately and are audited. */
export declare function updateMyProfile(patch: SelfServicePatch): Promise<Employee>;
/** GET /me/profile-changes — this person's requests for HR-approved fields. */
export declare function getMyProfileChanges(): Promise<ProfileChange[]>;
/** POST /me/profile-changes — routes to HR; the employee record changes only on approval. */
export declare function requestProfileChange(field: ProfileChangeField, after: string, reason: string): Promise<ProfileChange>;

// ---------------- work ----------------
/** GET /clients */
export declare function getClients(): Promise<Client[]>;
/** GET /clients/:id */
export declare function getClient(id: string): Promise<Client>;
/** GET /projects?search&clientId&managerId&status&memberId */
export declare function getProjects(filter?: ProjectFilter): Promise<Paginated<Project>>;
/** GET /projects/:id */
export declare function getProject(id: string): Promise<Project>;
/** GET /tasks?projectId&assigneeId&status */
export declare function getTasks(filter?: TaskFilter): Promise<Task[]>;
/** GET /tasks/:id */
export declare function getTask(id: string): Promise<Task>;
/** PATCH /tasks/:id */
export declare function updateTask(id: string, patch: Partial<Pick<Task, 'status' | 'assigneeId' | 'due' | 'priority' | 'title' | 'description' | 'subtasks'>>): Promise<Task>;
/** POST /projects/:id/tasks */
export declare function createTask(projectId: string, input: Pick<Task, 'title' | 'assigneeId' | 'due' | 'priority' | 'estimateHours'>): Promise<Task>;
/** POST /tasks/:id/comments */
export declare function addComment(taskId: string, text: string): Promise<Task>;
/** GET /timesheet-entries?employeeId&projectId&clientId&from&to&status&billable&ids */
export declare function getTimesheetEntries(filter?: TimesheetFilter): Promise<TimesheetEntry[]>;
/** GET /timesheet-weeks?employeeId&weekStart&status */
export declare function getTimesheetWeeks(filter?: {
    employeeId?: string;
    weekStart?: string;
    status?: string;
}): Promise<TimesheetWeek[]>;
export type WeekRowInput = {
    projectId: string;
    taskId: string | null;
    note: string;
    billable: boolean;
    hours: number[];
};
/** PUT /timesheet-weeks/:employeeId/:weekStart — replaces the week's draft entries with these rows. */
export declare function saveTimesheetWeek(employeeId: string, weekStart: string, rows: WeekRowInput[]): Promise<TimesheetEntry[]>;
/** POST /timesheet-weeks/:employeeId/:weekStart/submit — locks the week and opens an approval. */
export declare function submitTimesheetWeek(employeeId: string, weekStart: string): Promise<TimesheetWeek>;
/** POST /timesheet-weeks/:employeeId/:weekStart/recall — back to draft while still pending. */
export declare function recallTimesheetWeek(employeeId: string, weekStart: string): Promise<TimesheetWeek>;

// ---------------- finance ----------------
/** GET /invoices?search&clientId&status&page&pageSize */
export declare function getInvoices(filter?: InvoiceFilter): Promise<Paginated<Invoice>>;
/** GET /invoices/:id */
export declare function getInvoice(id: string): Promise<Invoice>;
/**
 * POST /invoices — the server builds lines from the selected approved entries and billable claims
 * (one time line per project and person), so a line can never disagree with its sources.
 */
export declare function createInvoice(input: NewInvoiceInput): Promise<Invoice>;
/** POST /invoices/:id/send */
export declare function sendInvoice(id: string): Promise<Invoice>;
/** POST /invoices/:id/payments */
export declare function recordPayment(id: string, p: {
    date: string;
    amount: number;
    method: Invoice['payments'][number]['method'];
    reference: string;
}, totalDue: number): Promise<Invoice>;
/**
 * POST /invoices/:id/revise { reason, lines, discount } — amends an issued invoice. The earlier state is kept in
 * `revisions` (the first entry is the invoice as issued), so the UI can show "as revised" and "as first issued".
 * Line amounts are recomputed here from quantity × rate; lines keep their entry and expense links.
 */
export declare function reviseInvoice(id: string, reason: string, lines: InvoiceLine[], discount: number): Promise<Invoice>;
/** GET /expenses?search&employeeId&clientId&projectId&status&billable&from&to */
export declare function getExpenses(filter?: ExpenseFilter): Promise<Paginated<ExpenseClaim>>;
/** GET /expenses/:id */
export declare function getExpense(id: string): Promise<ExpenseClaim>;
/** POST /expenses */
export declare function submitExpense(input: NewExpenseInput): Promise<ExpenseClaim>;
/** POST /expenses/:id/reopen — keeps the approved state as a revision. */
export declare function reopenExpense(id: string, reason: string, amount: number): Promise<ExpenseClaim>;
/** GET /budgets?fy */
export declare function getBudgets(): Promise<Budget[]>;

// ---------------- approvals ----------------
/** GET /approvals?type&status&approverId&requesterId — each with its source record embedded. */
export declare function getApprovals(filter?: ApprovalFilter): Promise<ApprovalWithSource[]>;
/**
 * POST /approvals/:id/decision { approve, comment }
 * Rejection needs a comment. The final approval applies the outcome to the source record.
 */
export declare function decideApproval(id: string, approve: boolean, comment?: string): Promise<ApprovalWithSource>;
/** POST /approvals/bulk-decision { ids, approve } */
export declare function approveMany(ids: string[]): Promise<number>;
/** GET /notifications */
export declare function getNotifications(): Promise<Notification[]>;
/** POST /notifications/read-all */
export declare function markAllNotificationsRead(): Promise<void>;

// ---------------- clients ----------------
/** GET /leads */
export declare function getLeads(): Promise<Lead[]>;
/** GET /leads/:id */
export declare function getLead(id: string): Promise<Lead>;
/** PATCH /leads/:id { stage } */
export declare function moveLead(id: string, stage: LeadStage): Promise<Lead>;
/** GET /contracts */
export declare function getContracts(): Promise<Contract[]>;
/** GET /tickets?clientId */
export declare function getTickets(clientId?: string): Promise<Ticket[]>;
/** GET /tickets/:id */
export declare function getTicket(id: string): Promise<Ticket>;
/** POST /tickets/:id/messages { text, internal } */
export declare function replyToTicket(id: string, text: string, internal: boolean): Promise<Ticket>;
/** PATCH /tickets/:id { status } */
export declare function setTicketStatus(id: string, status: Ticket['status']): Promise<Ticket>;
/** GET /documents?ownerType&ownerId */
export declare function getDocuments(ownerType: Document['ownerType'], ownerId?: string): Promise<Document[]>;
export declare function uploadFile(file: File): Promise<UploadedFile>;
/** POST /documents/:id/versions { note, fileId } */
export declare function uploadVersion(id: string, note: string, fileId?: string): Promise<Document>;
/** GET /documents/:id/versions/:version/download — returns a short-lived URL. */
export declare function getDocumentUrl(id: string, version?: number): Promise<{
    url: string;
    filename: string;
}>;

// ---------------- workplace ----------------
/** GET /assets */
export declare function getAssets(): Promise<Asset[]>;
/** GET /me/assets — items currently allocated to the signed-in person. */
export declare function getMyAssets(): Promise<Asset[]>;
/** POST /assets/:id/issues — the holder reports a problem; IT sees it on the asset. */
export declare function reportAssetIssue(id: string, text: string): Promise<Asset>;
/** GET /assets/:id */
export declare function getAsset(id: string): Promise<Asset>;
/** POST /assets/:id/allocate { employeeId } — closes any open allocation first. */
export declare function allocateAsset(id: string, employeeId: string | null, note: string): Promise<Asset>;
/** GET /inventory */
export declare function getInventory(): Promise<InventoryItem[]>;
/** POST /inventory/:id/movements { kind, qty, note } */
export declare function moveStock(id: string, kind: 'in' | 'out', qty: number, note: string): Promise<InventoryItem>;
/** GET /rooms */
export declare function getRooms(): Promise<Room[]>;
/** GET /bookings?date */
export declare function getBookings(date: string): Promise<Booking[]>;
/** POST /bookings — refuses overlaps. */
export declare function createBooking(b: Omit<Booking, 'id' | 'bookedById'>): Promise<Booking>;
/** GET /announcements */
export declare function getAnnouncements(): Promise<Announcement[]>;
/** POST /announcements/:id/acknowledge */
export declare function acknowledge(id: string): Promise<Announcement>;
/** GET /kb */
export declare function getKbArticles(): Promise<KbArticle[]>;
/** GET /kb/:slug */
export declare function getKbArticle(slug: string): Promise<KbArticle>;
/** GET /visitors?date */
export declare function getVisitors(date?: string): Promise<Visitor[]>;
/** POST /visitors/:id/check-in | check-out (kiosk) */
export declare function checkVisitor(id: string, action: 'in' | 'out'): Promise<Visitor>;
/** POST /visitors (kiosk walk-in or pre-registration) */
export declare function registerVisitor(input: Pick<Visitor, 'name' | 'company' | 'hostId' | 'purpose' | 'date' | 'expected'>, checkInNow: boolean): Promise<Visitor>;

// ---------------- admin ----------------
/** GET /users */
export declare function getUsers(): Promise<AppUser[]>;
/** POST /users/invite */
export declare function inviteUser(input: {
    name: string;
    email: string;
    role: string;
}): Promise<AppUser>;
/** POST /users/:id/invite — a fresh invitation link for someone who hasn't set a password yet. */
export declare function resendInvite(id: string): Promise<AppUser>;
/** PATCH /users/:id { status | role } */
export declare function updateUser(id: string, patch: Partial<Pick<AppUser, 'status' | 'role'>>): Promise<AppUser>;
/** GET /roles */
export declare function getRoles(): Promise<RoleDef[]>;
/** PUT /roles/:id/permissions/:module { permission } */
export declare function setPermission(roleId: string, module: string, perm: Permission): Promise<RoleDef>;
/** GET /workflows */
export declare function getWorkflows(): Promise<Workflow[]>;
/** GET /workflows/:id */
export declare function getWorkflow(id: string): Promise<Workflow>;
/** PUT /workflows/:id */
export declare function saveWorkflow(w: Workflow): Promise<Workflow>;
/** GET /notification-rules */
export declare function getNotificationRules(): Promise<NotificationRule[]>;
/** PATCH /notification-rules/:id { channels } */
export declare function setNotificationChannel(id: string, channel: keyof NotificationRule['channels'], on: boolean): Promise<NotificationRule>;
/** GET /audit?search&entity&actorId&from&to&page&pageSize — read-only; there is no delete endpoint. */
export declare function getAuditEvents(filter?: AuditFilter): Promise<Paginated<AuditEvent>>;
/** GET /masters */
export declare function getMasters(): Promise<MasterList[]>;
/** PUT /masters/:id/rows/:rowId | POST /masters/:id/rows */
export declare function saveMasterRow(listId: string, row: {
    id?: string;
    values: string[];
    active: boolean;
}): Promise<MasterList>;
/** GET /system-jobs */
export declare function getSystemJobs(): Promise<SystemJob[]>;

// ---------------- session ----------------
/**
 * Session and sign-in, for the in-memory build. No authentication happens here: the role comes from `?role=`
 * (the demo's role switch). The real API (backend http/routes/session.routes.ts) returns the same shapes.
 * Each function resolves after a short delay so loading and error states are visible.
 */
/** The signed-in session as GET /me returns it: the person, their role, the organisation, and the server's clock. */
export type Me = {
    employee: Employee;
    role: Role;
    orgName: string;
    /** Today in the organisation's zone, YYYY-MM-DD. */
    today: string;
    /** Now, ISO 8601 with the organisation's offset. */
    now: string;
    timeZone: string;
    /** The first day with records; history views start here. */
    historyFrom: string;
};
/** GET /me */
export declare function getMe(): Promise<Me>;
/**
 * POST /auth/login — the API sets the session cookie and returns the account's role, so the app lands on the
 * right home. Stub: any password of 8+ characters "works"; "wrongpass" shows the error state.
 */
export declare function login(email: string, password: string): Promise<{
    ok: true;
    role: Role | 'Client';
}>;
/** POST /auth/logout — ends the session and clears the cookie. */
export declare function logout(): Promise<void>;
/** POST /auth/forgot — stub. */
export declare function requestPasswordReset(email: string): Promise<{
    ok: true;
}>;
/** GET /setup/:token — stub. Tokens starting with "expired" are rejected. */
export declare function checkSetupToken(token: string): Promise<{
    orgName: string;
    email: string;
}>;
export type SetupInput = {
    orgName: string;
    legalName: string;
    state: string;
    gstin: string;
    adminName: string;
    password: string;
    modules: string[];
};
/** POST /setup/:token — stub. */
export declare function completeSetup(_token: string, input: SetupInput): Promise<{
    ok: true;
}>;
/** GET /auth/reset/:token — whose password link it is (an invitation sets a first password). */
export declare function checkResetToken(token: string): Promise<{
    email: string;
    name: string;
    invite: boolean;
}>;
/** POST /auth/reset/:token { password } — sets the password and signs in. */
export declare function completeReset(_token: string, password: string): Promise<{
    ok: true;
    role: Role;
}>;
/** POST /demo-requests — stub. */
export declare function requestDemo(input: {
    name: string;
    email: string;
    company: string;
    size: string;
}): Promise<{
    ok: true;
}>;

// ---------------- portal ----------------
/** GET /portal/session */
export declare function getPortalSession(): Promise<PortalSession>;
/** GET /portal/projects */
export declare function getPortalProjects(): Promise<PortalProject[]>;
/** GET /portal/projects/:id */
export declare function getPortalProject(id: string): Promise<PortalProject>;
/** GET /portal/invoices */
export declare function getPortalInvoices(): Promise<PortalInvoice[]>;
/** GET /portal/invoices/:id */
export declare function getPortalInvoice(id: string): Promise<PortalInvoice>;
/**
 * POST /portal/invoices/:id/pay — stub for the payment gateway. A real gateway confirms by webhook;
 * here the balance is settled after a delay and recorded against the invoice, as Finance would see it.
 */
export declare function payPortalInvoice(id: string, method: 'UPI' | 'NEFT'): Promise<PortalInvoice>;
/** GET /portal/tickets */
export declare function getPortalTickets(): Promise<PortalTicket[]>;
/** GET /portal/tickets/:id */
export declare function getPortalTicket(id: string): Promise<PortalTicket>;
/** POST /portal/tickets */
export declare function raisePortalTicket(input: {
    subject: string;
    text: string;
    priority: Ticket['priority'];
    projectId: string | null;
}): Promise<PortalTicket>;
/** POST /portal/tickets/:id/messages */
export declare function replyPortalTicket(id: string, text: string): Promise<PortalTicket>;
/** GET /portal/documents — only documents shared with the client. */
export declare function getPortalDocuments(): Promise<PortalDocument[]>;
/** GET /portal/documents/:id/download — latest shared version, as a short-lived URL. */
export declare function getPortalDocumentUrl(id: string): Promise<{
    url: string;
    filename: string;
}>;

// ---------------- dashboard ----------------
/** GET /dashboard-facts?role — the figures, hub attention lists and dashboard list for the signed-in person. */
export declare function getDashboardFacts(role?: Role): Promise<DashboardFacts>;
/** GET /dashboard-blocks?metric&range&colour — one view of the analytics blocks for the signed-in person. */
export declare function getDashboardBlocks(metric: number, range: Range, colour: BlockColour): Promise<BlockModel>;
