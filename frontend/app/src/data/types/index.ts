/**
 * Shared domain types. These are the shapes the backend must return.
 * Dates are ISO `YYYY-MM-DD` strings; timestamps are ISO 8601 strings; money is INR rupees as numbers.
 */

export type ID = string;
export type ISODate = string;
export type ISODateTime = string;

export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
export type PageQuery = { page?: number; pageSize?: number; search?: string; sort?: string; dir?: 'asc' | 'desc' };

/** A figure the system cannot state authoritatively (tax estimates, derived rates). UI renders a marker. */
export type Estimated = { value: number; estimated: true; basis: string };

export type Role = 'Admin' | 'HR' | 'Manager' | 'Employee';

// ---------------- People ----------------
export type Department = 'Leadership' | 'Engineering' | 'Delivery' | 'Design' | 'Sales' | 'Operations' | 'People' | 'Finance';
export type EmploymentType = 'Full-time' | 'Contract' | 'Intern';
export type EmployeeStatus = 'Active' | 'On leave' | 'Probation' | 'Inactive';

export type Employee = {
  id: ID;
  name: string;
  email: string;
  personalEmail: string;
  phone: string;
  title: string;
  dept: Department;
  managerId: ID | null;
  location: string;
  /** Statutory state for Professional Tax. */
  state: string;
  type: EmploymentType;
  status: EmployeeStatus;
  joined: ISODate;
  dob: ISODate;
  bloodGroup: string;
  maritalStatus: 'Married' | 'Single';
  address: string;
  emergency: { name: string; relation: string; phone: string };
  bank: { name: string; ifsc: string; accountLast4: string };
  pan: string;
  uan: string;
  /** Delivery staff log billable time. */
  billable: boolean;
  /** Client-facing hourly rate, ₹. */
  billRate: number;
  noticeDays: number;
  confirmationDue: ISODate | null;
};

export type EmployeeFilter = PageQuery & { dept?: string; location?: string; status?: string; managerId?: ID; type?: string };

/** Append-only salary ledger. Nothing is overwritten; corrections are new events. */
export type SalaryEventType = 'Hired' | 'Revised' | 'Promotion' | 'Bonus' | 'Correction' | 'Deduction';
export type SalaryEvent = {
  id: ID;
  employeeId: ID;
  type: SalaryEventType;
  /** First month the event is effective for (YYYY-MM-01). */
  effective: ISODate;
  /** When it was written to the ledger. A correction recorded after its effective month creates an as-paid/as-corrected difference. */
  recorded: ISODate;
  /** New annual CTC (Hired/Revised/Promotion). */
  ctc?: number;
  /** One-time amount (Bonus/Deduction), or the monthly uplift for each month in `appliesTo` (Correction). */
  amount?: number;
  /** Correction only: months (YYYY-MM) the correction applies to retroactively. */
  appliesTo?: string[];
  /** Correction only: which component it corrects. */
  component?: 'HRA' | 'Special allowance';
  actorId: ID;
  note: string;
  title?: string;
};

export type AttendanceMark = 'P' | 'Late' | 'Half day' | 'Leave' | 'Absent' | 'Holiday' | 'Weekend' | 'WFH';
export type AttendanceDay = {
  id: ID;
  employeeId: ID;
  date: ISODate;
  mark: AttendanceMark;
  in: string | null;
  out: string | null;
  /** Regularised marks keep the original. */
  regularisedFrom?: AttendanceMark;
};
export type AttendanceFilter = { employeeId?: ID; from: ISODate; to: ISODate };

export type Holiday = { date: ISODate; name: string };

export type LeaveTypeCode = 'CL' | 'SL' | 'EL' | 'CO' | 'ML' | 'PL';
export type LeaveType = {
  code: LeaveTypeCode;
  name: string;
  accrual: string;
  /** Days per FY (annualised). */
  entitlement: number;
  carryForwardCap: number | null;
  encashment: string;
  appliesTo: string;
};
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type LeaveRequest = {
  id: ID;
  employeeId: ID;
  type: LeaveTypeCode;
  from: ISODate;
  to: ISODate;
  days: number;
  reason: string;
  submitted: ISODate;
  status: LeaveStatus;
  approvalId: ID | null;
};
export type LeaveFilter = { employeeId?: ID; status?: LeaveStatus; from?: ISODate; to?: ISODate };

export type PayrollStage = 'Inputs' | 'Review' | 'Approved' | 'Disbursed';
export type PayrollRun = {
  id: ID;
  /** YYYY-MM */
  month: string;
  stage: PayrollStage;
  lockDate: ISODate;
  disbursedOn: ISODate | null;
  employeeIds: ID[];
  /** The salary events this run was computed from (effective on or before the month, recorded before the lock). */
  salaryEventIds: ID[];
  /** Attendance date range the run read loss-of-pay from. */
  attendanceFrom: ISODate;
  attendanceTo: ISODate;
  bankFileIssues: { employeeId: ID; issue: string }[];
};

export type SalaryComponent = {
  id: ID;
  name: string;
  kind: 'Earning' | 'Deduction' | 'Employer contribution';
  /** Formula tokens, e.g. "CTC / 12 * 0.40". Variables: CTC, MONTHLY, BASIC, GROSS. */
  formula: string;
  taxable: boolean;
};
export type SalaryStructure = { id: ID; name: string; appliesTo: string; components: SalaryComponent[] };

export type StatutoryFiling = {
  id: ID;
  kind: 'PF' | 'ESI' | 'PT' | 'TDS';
  period: string;
  due: ISODate;
  filedOn: ISODate | null;
  reference: string | null;
};

// ---------------- Recruitment, onboarding, performance, training ----------------
export type Job = { id: ID; title: string; dept: Department; location: string; openings: number; status: 'Open' | 'On hold' | 'Closed'; posted: ISODate; hiringManagerId: ID };
export type CandidateStage = 'Applied' | 'Screening' | 'Interviewing' | 'Offer' | 'Hired' | 'Rejected';
export type Candidate = {
  id: ID; jobId: ID; name: string; email: string; source: string; stage: CandidateStage; applied: ISODate;
  experienceYears: number; currentCompany: string; notes: string;
  interviews: { id: ID; round: string; interviewerId: ID; date: ISODate; outcome: 'Strong yes' | 'Yes' | 'No' | 'Pending' }[];
};
export type OnboardingKind = 'Joining' | 'Leaving';
export type ChecklistOwner = 'HR' | 'IT' | 'Manager' | 'Finance';
export type OnboardingCase = {
  id: ID; kind: OnboardingKind; employeeId: ID | null; personName: string; title: string; dept: Department; date: ISODate;
  items: { id: ID; owner: ChecklistOwner; label: string; done: boolean; doneOn: ISODate | null }[];
};
export type ReviewCycle = { id: ID; name: string; period: string; stage: 'Goal setting' | 'Self review' | 'Manager review' | 'Calibration' | 'Closed'; selfDue: ISODate; managerDue: ISODate };
export type Review = {
  id: ID; cycleId: ID; employeeId: ID; reviewerId: ID;
  status: 'Not started' | 'Self review' | 'Manager review' | 'Completed';
  rating: 'Exceeds expectations' | 'Meets expectations' | 'Below expectations' | null;
  selfAnswers: string[]; managerAnswers: string[];
};
export type Goal = { id: ID; employeeId: ID; cycleId: ID; title: string; progress: number; measure: string };
export type TrainingProgramme = { id: ID; name: string; kind: 'Course' | 'Certification' | 'Compliance'; mandatory: boolean; validityMonths: number | null };
export type Certification = { id: ID; programmeId: ID; employeeId: ID; completed: ISODate | null; expires: ISODate | null; status: 'Valid' | 'Expiring' | 'Expired' | 'Assigned' };

// ---------------- Clients & work ----------------
export type Client = {
  id: ID; name: string; industry: string; city: string; state: string; gstin: string; ownerId: ID;
  status: 'Active' | 'Inactive'; since: ISODate; paymentTermsDays: number;
  contacts: { id: ID; name: string; title: string; email: string; phone: string; primary: boolean }[];
};
export type BillingModel = 'T&M' | 'Fixed fee';
export type ProjectHealth = 'On track' | 'At risk' | 'Off track' | 'Completed';
export type ProjectMember = { employeeId: ID; role: string; allocation: number };
export type Project = {
  id: ID; name: string; code: string; clientId: ID; managerId: ID; start: ISODate; end: ISODate;
  model: BillingModel; fee: number | null; budget: number; health: ProjectHealth; status: 'Active' | 'Completed' | 'On hold';
  team: ProjectMember[];
  milestones: { id: ID; name: string; date: ISODate; done: boolean }[];
  phases: { id: ID; name: string; start: ISODate; end: ISODate; dependsOn: ID[] }[];
};
export type ProjectFilter = PageQuery & { clientId?: ID; managerId?: ID; status?: string; memberId?: ID };

export type TaskStatus = 'todo' | 'progress' | 'review' | 'done';
export type TaskPriority = 'Urgent' | 'High' | 'Medium' | 'Low';
export type Task = {
  id: ID; projectId: ID; title: string; status: TaskStatus; priority: TaskPriority; assigneeId: ID;
  due: ISODate; estimateHours: number; phaseId: ID | null; created: ISODate;
  subtasks: { id: ID; title: string; done: boolean }[];
  comments: { id: ID; authorId: ID; at: ISODateTime; text: string }[];
  description: string;
};
export type TaskFilter = { projectId?: ID; assigneeId?: ID; status?: TaskStatus };

export type EntryStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected';
export type TimesheetEntry = {
  id: ID; employeeId: ID; projectId: ID; clientId: ID; taskId: ID | null; date: ISODate;
  hours: number; billable: boolean; note: string; status: EntryStatus;
};
export type TimesheetFilter = { employeeId?: ID; projectId?: ID; clientId?: ID; from?: ISODate; to?: ISODate; status?: EntryStatus; billable?: boolean; ids?: ID[] };

/** One employee-week. Revisions keep every submitted state (as submitted / as resubmitted). */
export type TimesheetWeek = {
  id: ID; employeeId: ID; weekStart: ISODate; status: EntryStatus; approvalId: ID | null;
  /** Each submit, rejection and approval, with the entries as they stood at that step (the dual-state history). */
  revisions: { at: ISODateTime; status: EntryStatus; totalHours: number; billableHours: number; note: string; entries?: TimesheetEntry[] }[];
};

// ---------------- Finance ----------------
export type InvoiceStatus = 'Draft' | 'Sent' | 'Partially paid' | 'Paid' | 'Overdue' | 'Void';
export type InvoiceLine = {
  id: ID; kind: 'time' | 'expense' | 'milestone' | 'manual';
  projectId: ID | null; description: string;
  /** The timesheet entries behind this line. Milestone lines reference the entries in their period. */
  entryIds: ID[];
  expenseIds: ID[];
  quantity: number; unit: 'h' | 'item'; rate: number;
  /** quantity × rate, rounded to the rupee. Pre-tax. */
  amount: number;
};
export type Invoice = {
  id: ID; number: string; clientId: ID; issued: ISODate; due: ISODate; status: InvoiceStatus;
  lines: InvoiceLine[]; discount: number; notes: string;
  payments: { id: ID; date: ISODate; amount: number; method: 'NEFT' | 'RTGS' | 'Cheque' | 'UPI'; reference: string }[];
  /** Earlier issued states of a revised invoice (as issued vs as revised). */
  revisions: { at: ISODateTime; reason: string; lines: InvoiceLine[]; discount: number }[];
  approvalId: ID | null;
};
export type InvoiceFilter = PageQuery & { clientId?: ID; status?: string; ageing?: string };
export type NewInvoiceInput = {
  clientId: ID; issued: ISODate; termsDays: number; notes: string; discount: number;
  entryIds: ID[]; expenseIds: ID[]; manual: { description: string; amount: number }[];
};

export type ExpenseCategory = 'Travel' | 'Meals' | 'Software' | 'Hardware' | 'Training' | 'Client entertainment' | 'Office';
export type ExpenseStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Reimbursed';
export type ExpenseClaim = {
  id: ID; employeeId: ID; category: ExpenseCategory; description: string; amount: number; date: ISODate;
  projectId: ID | null; clientId: ID | null; billable: boolean; receipt: boolean; status: ExpenseStatus;
  submitted: ISODate; reimbursedOn: ISODate | null; approvalId: ID | null;
  /** A reopened claim keeps what was approved before. */
  revisions: { at: ISODateTime; amount: number; description: string; status: ExpenseStatus; reason: string }[];
};
export type ExpenseFilter = PageQuery & { employeeId?: ID; clientId?: ID; projectId?: ID; status?: string; billable?: boolean; from?: ISODate; to?: ISODate };
export type NewExpenseInput = Pick<ExpenseClaim, 'category' | 'description' | 'amount' | 'date' | 'projectId' | 'billable' | 'receipt'>;

export type Budget = { id: ID; dept: Department; fy: string; planned: number; committed: number; lines: { category: string; planned: number }[] };

// ---------------- Clients extra ----------------
export type LeadStage = 'New' | 'Qualified' | 'Proposal sent' | 'Negotiation' | 'Won' | 'Lost';
export type Lead = {
  id: ID; company: string; contact: string; value: number; stage: LeadStage; ownerId: ID; source: string;
  stageSince: ISODate; created: ISODate; probability: number; notes: string;
  activity: { at: ISODate; text: string; byId: ID }[];
};
export type Contract = {
  id: ID; clientId: ID; title: string; kind: 'MSA' | 'SOW' | 'NDA' | 'AMC'; start: ISODate; end: ISODate; value: number;
  autoRenew: boolean; slaResponseHours: number; slaResolutionHours: number; status: 'Active' | 'Expired' | 'Draft';
};
export type TicketPriority = 'Urgent' | 'High' | 'Medium' | 'Low';
export type Ticket = {
  id: ID; clientId: ID; projectId: ID | null; subject: string; priority: TicketPriority; assigneeId: ID;
  status: 'Open' | 'In progress' | 'Waiting on client' | 'Resolved'; opened: ISODateTime; resolved: ISODateTime | null;
  /** Due time for resolution, from the contract SLA. */
  slaDue: ISODateTime;
  messages: { id: ID; at: ISODateTime; author: string; authorId: ID | null; internal: boolean; text: string }[];
};

// ---------------- Workplace ----------------
export type Asset = {
  id: ID; tag: string; name: string; category: 'Laptop' | 'Monitor' | 'Phone' | 'Accessory' | 'Furniture' | 'Licence';
  serial: string; purchased: ISODate; cost: number; status: 'Allocated' | 'Available' | 'Under repair' | 'Retired';
  allocations: { employeeId: ID; from: ISODate; to: ISODate | null; note: string }[];
  /** Problems reported by the holder, for IT to pick up. */
  issues?: { id: ID; at: ISODateTime; reportedById: ID; text: string }[];
};
export type InventoryItem = {
  id: ID; name: string; unit: string; stock: number; reorderLevel: number; location: string;
  movements: { id: ID; date: ISODate; kind: 'in' | 'out'; qty: number; note: string; byId: ID }[];
};
export type Room = { id: ID; name: string; floor: string; capacity: number; equipment: string[] };
export type Booking = { id: ID; roomId: ID; date: ISODate; start: string; end: string; title: string; bookedById: ID };
export type Announcement = {
  id: ID; title: string; body: string; authorId: ID; posted: ISODate; pinned: boolean;
  audience: string; requiresAck: boolean; ackIds: ID[]; audienceIds: ID[];
};
export type KbArticle = {
  id: ID; slug: string; title: string; category: string; updated: ISODate; authorId: ID;
  sections: { id: string; heading: string; body: string[] }[];
};
export type Visitor = {
  id: ID; name: string; company: string; hostId: ID; date: ISODate; expected: string;
  checkedIn: string | null; checkedOut: string | null; purpose: string; badge: string | null;
};

// ---------------- Approvals ----------------
export type ApprovalType = 'Leave' | 'Expense' | 'Timesheet' | 'Regularisation' | 'Invoice' | 'Profile change';

/** Self-service edits to fields HR must verify. The employee record changes only when HR approves. */
export type ProfileChangeField = 'Legal name' | 'Address' | 'Marital status' | 'Bank account' | 'PAN';
export type ProfileChange = {
  id: ID; employeeId: ID; field: ProfileChangeField; before: string; after: string; reason: string;
  submitted: ISODate; status: ApprovalStatus; approvalId: ID;
};
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';
export type ApprovalStep = { approverId: ID; role: string; decision: 'Approved' | 'Rejected' | null; at: ISODateTime | null; comment: string | null };
export type Approval = {
  id: ID; type: ApprovalType; sourceId: ID; requesterId: ID; submitted: ISODate; status: ApprovalStatus;
  /** Step 0 is the requester. */
  chain: ApprovalStep[];
  current: number;
};
/** An approval as the API returns it: the source record is embedded so the queue can describe it. */
export type ApprovalSource =
  | { kind: 'Leave'; leave: LeaveRequest }
  | { kind: 'Expense'; expense: ExpenseClaim }
  | { kind: 'Timesheet'; week: TimesheetWeek; entries: TimesheetEntry[] }
  | { kind: 'Regularisation'; reg: RegularisationRequest }
  | { kind: 'Invoice'; invoice: Invoice }
  | { kind: 'Profile change'; change: ProfileChange };
export type ApprovalWithSource = Approval & { source: ApprovalSource };
export type ApprovalFilter = { type?: ApprovalType; status?: ApprovalStatus; approverId?: ID; requesterId?: ID };

export type RegularisationRequest = {
  id: ID; employeeId: ID; date: ISODate; recorded: string; requested: string; reason: string;
  requestedMark: AttendanceMark; requestedIn: string | null; requestedOut: string | null; approvalId: ID;
};

// ---------------- Admin ----------------
export type AppUser = { id: ID; employeeId: ID | null; email: string; name: string; role: string; status: 'Active' | 'Invited' | 'Deactivated'; lastActive: ISODateTime | null; invited: ISODate };
export type Permission = 'none' | 'view' | 'edit' | 'approve';
export type RoleDef = { id: ID; name: string; seeded: boolean; description: string; permissions: Record<string, Permission> };
export type WorkflowNodeKind = 'Trigger' | 'Condition' | 'Approver' | 'Notification' | 'Outcome';
export type WorkflowNode = { id: ID; kind: WorkflowNodeKind; label: string; x: number; y: number; config: Record<string, string> };
export type Workflow = {
  id: ID; name: string; module: ApprovalType | 'Onboarding'; status: 'Active' | 'Paused' | 'Draft'; updated: ISODate;
  nodes: WorkflowNode[]; edges: { id: ID; from: ID; to: ID; label?: string }[];
};
export type NotificationRule = { id: ID; event: string; module: string; channels: { inApp: boolean; email: boolean; digest: boolean } };
export type AuditEvent = {
  id: ID; at: ISODateTime; actorId: ID | null; actor: string; action: string; entity: string; entityId: ID;
  changes: { field: string; before: string | null; after: string | null }[]; ip: string;
};
export type AuditFilter = PageQuery & { entity?: string; actorId?: ID; from?: ISODate; to?: ISODate };
export type MasterList = { id: ID; name: string; columns: string[]; rows: { id: ID; values: string[]; active: boolean }[] };
export type SystemJob = { id: ID; name: string; lastRun: ISODateTime; status: 'Succeeded' | 'Failed'; detail: string };

export type Notification = {
  id: ID; at: ISODateTime; kind: 'Approval' | 'Mention' | 'Payroll' | 'Contracts' | 'System';
  text: string; href: string; approvalId: ID | null; actorId: ID | null; recipientId: ID; read: boolean;
};

/** A file stored by POST /uploads, before it is attached to a record. */
export type UploadedFile = { id: ID; filename: string; contentType: string; size: number; sizeLabel: string };

export type Document = {
  id: ID; ownerType: 'employee' | 'project' | 'client'; ownerId: ID; name: string; type: string;
  versions: { version: number; uploaded: ISODate; byId: ID; size: string; note: string }[];
  expires: ISODate | null; visibleToClient: boolean;
};

/** The signed-in session (UI only — no auth implementation). */
export type Session = { employeeId: ID; role: Role; orgName: string };

// ---------------- Client portal ----------------
// What a client sees: client-safe projections, never the internal records (no team, assignees, hours, internal
// tasks, internal notes or hidden documents).
export type PortalSession = { clientId: string; clientName: string; contactName: string; contactEmail: string; vendorName: string };
export type PortalProject = {
  id: string; name: string; start: string; end: string; status: 'Active' | 'Completed' | 'On hold';
  /** Share of scope delivered, 0–100. */
  progress: number;
  phases: { id: string; name: string; start: string; end: string }[];
  milestones: { id: string; name: string; date: string; done: boolean }[];
};
export type PortalInvoice = {
  id: string; number: string; issued: string; due: string; status: 'Sent' | 'Partially paid' | 'Paid' | 'Overdue';
  lines: { id: string; description: string; quantity: number; unit: 'h' | 'item'; rate: number; amount: number }[];
  subtotal: number; tax: number; total: number; paid: number; balance: number;
  /** The GST split as issued: CGST + SGST within the firm's state, IGST across states. */
  gst: { cgst: number; sgst: number; igst: number };
  payments: { date: string; amount: number; method: string; reference: string }[];
  /** Set when the invoice was revised after it was issued: the client sees both totals and the reason. */
  revision: { at: string; reason: string; firstIssuedTotal: number } | null;
};
export type PortalTicket = Omit<Ticket, 'assigneeId' | 'messages'> & { messages: { id: string; at: string; author: string; fromClient: boolean; text: string }[] };
export type PortalDocument = { id: string; name: string; type: string; project: string | null; version: number; uploaded: string; size: string };
