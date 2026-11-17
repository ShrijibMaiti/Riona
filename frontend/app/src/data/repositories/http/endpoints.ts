/**
 * The API contract, one entry per repository function: the route it calls and how its arguments travel.
 *
 * - `routes`: 'METHOD /path/:param' (relative to VITE_API_BASE_URL). Most functions have one; a few pick
 *   between two (saveMasterRow creates or updates, checkVisitor checks in or out).
 * - `call`: arguments → { params, query, body } for the HTTP client (./client.ts).
 * - `args`: the inverse, request → arguments (the contract test round-trips every function through both).
 *
 * The table is typed against ../contract.ts, so a repository function without an entry, or an entry whose `call`
 * doesn't accept that function's arguments, fails the type-check. The backend implements exactly these routes
 * (backend/test/contract/coverage.test.ts).
 */
import type * as Contract from '../contract';

type AnyFn = (...a: never[]) => Promise<unknown>;
type ContractModule = typeof Contract;
/** Every repository function, by name, with its signature (../contract.ts). */
export type Repo = { [K in keyof ContractModule as ContractModule[K] extends AnyFn ? K : never]: ContractModule[K] };

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Req = {
  /** Index into `routes` when there is more than one. */
  route?: number;
  params?: Record<string, string | number>;
  query?: object;
  body?: unknown;
};
/** A request as the mock receives it: which of `routes` matched, path params, decoded query (see decodeQuery) and the parsed JSON body. */
export type Incoming = {
  route: number;
  params: Record<string, string>;
  query: Record<string, string | number | boolean | string[]>;
  body: any;
};
export type Endpoint<F extends (...a: never[]) => unknown> = {
  routes: [string, ...string[]];
  call: (...a: Parameters<F>) => Req;
  args: (r: Incoming) => unknown[];
};

// ---- the shapes most functions share ----
type Route = `${Method} /${string}`;
const none = (route: Route) => ({ routes: [route] as [string], call: (): Req => ({}), args: () => [] });
const byId = (route: Route) => ({ routes: [route] as [string], call: (id: string): Req => ({ params: { id } }), args: (r: Incoming) => [r.params.id] });
const filtered = (route: Route) => ({ routes: [route] as [string], call: (filter: object = {}): Req => ({ query: filter }), args: (r: Incoming) => [r.query] });
const withBody = (route: Route) => ({ routes: [route] as [string], call: (body: unknown): Req => ({ body }), args: (r: Incoming) => [r.body] });
const idAndBody = (route: Route) => ({
  routes: [route] as [string],
  call: (id: string, body: unknown): Req => ({ params: { id }, body }),
  args: (r: Incoming) => [r.params.id, r.body],
});
/** One optional query value as the only argument: getCandidates(jobId?) → GET /candidates?jobId= */
const oneQuery = (route: Route, key: string) => ({
  routes: [route] as [string],
  call: (value?: string): Req => ({ query: { [key]: value } }),
  args: (r: Incoming) => [r.query[key]],
});

export const ENDPOINTS: { [K in keyof Repo]: Endpoint<Repo[K]> } = {
  // ---------------- people ----------------
  getEmployees: filtered('GET /employees'),
  getEmployee: byId('GET /employees/:id'),
  updateEmployee: idAndBody('PATCH /employees/:id'),
  revealBankAccount: byId('POST /employees/:id/bank/reveal'),
  getSalaryEvents: byId('GET /employees/:id/salary-events'),
  getAllSalaryEvents: none('GET /salary-events'),
  appendSalaryEvent: {
    routes: ['POST /employees/:id/salary-events'],
    call: (ev) => ({ params: { id: ev.employeeId }, body: ev }),
    args: (r) => [{ ...r.body, employeeId: r.params.id }],
  },
  getAttendance: filtered('GET /attendance'),
  getHolidays: none('GET /holidays'),
  getRegularisations: filtered('GET /regularisations'),
  requestRegularisation: withBody('POST /regularisations'),
  getLeaveTypes: none('GET /leave-types'),
  getLeaveRequests: filtered('GET /leave-requests'),
  applyLeave: withBody('POST /leave-requests'),
  cancelLeave: byId('POST /leave-requests/:id/cancel'),
  getPayrollRuns: none('GET /payroll-runs'),
  getPayrollRun: byId('GET /payroll-runs/:id'),
  advancePayrollRun: byId('POST /payroll-runs/:id/advance'),
  getSalaryStructures: none('GET /salary-structures'),
  saveSalaryStructure: {
    routes: ['PUT /salary-structures/:id'],
    call: (s) => ({ params: { id: s.id }, body: s }),
    args: (r) => [{ ...r.body, id: r.params.id }],
  },
  getFilings: none('GET /statutory-filings'),
  getJobs: none('GET /jobs'),
  getJob: byId('GET /jobs/:id'),
  getCandidates: oneQuery('GET /candidates', 'jobId'),
  getCandidate: byId('GET /candidates/:id'),
  moveCandidate: {
    routes: ['PATCH /candidates/:id'],
    call: (id, stage) => ({ params: { id }, body: { stage } }),
    args: (r) => [r.params.id, r.body.stage],
  },
  getOnboarding: none('GET /onboarding'),
  getOnboardingCase: byId('GET /onboarding/:id'),
  setChecklistItem: {
    routes: ['PATCH /onboarding/:id/items/:itemId'],
    call: (caseId, itemId, done) => ({ params: { id: caseId, itemId }, body: { done } }),
    args: (r) => [r.params.id, r.params.itemId, r.body.done],
  },
  getReviewCycles: none('GET /review-cycles'),
  getReviews: filtered('GET /reviews'),
  getReview: byId('GET /reviews/:id'),
  saveReview: idAndBody('PUT /reviews/:id'),
  getGoals: oneQuery('GET /goals', 'employeeId'),
  getProgrammes: none('GET /training/programmes'),
  getCertifications: oneQuery('GET /training/certifications', 'employeeId'),
  createEmployee: withBody('POST /employees'),
  updateMyProfile: withBody('PATCH /me/profile'),
  getMyProfileChanges: none('GET /me/profile-changes'),
  requestProfileChange: {
    routes: ['POST /me/profile-changes'],
    call: (field, after, reason) => ({ body: { field, after, reason } }),
    args: (r) => [r.body.field, r.body.after, r.body.reason],
  },

  // ---------------- work ----------------
  getClients: none('GET /clients'),
  getClient: byId('GET /clients/:id'),
  getProjects: filtered('GET /projects'),
  getProject: byId('GET /projects/:id'),
  getTasks: filtered('GET /tasks'),
  getTask: byId('GET /tasks/:id'),
  updateTask: idAndBody('PATCH /tasks/:id'),
  createTask: idAndBody('POST /projects/:id/tasks'),
  addComment: {
    routes: ['POST /tasks/:id/comments'],
    call: (taskId, text) => ({ params: { id: taskId }, body: { text } }),
    args: (r) => [r.params.id, r.body.text],
  },
  getTimesheetEntries: filtered('GET /timesheet-entries'),
  getTimesheetWeeks: filtered('GET /timesheet-weeks'),
  saveTimesheetWeek: {
    routes: ['PUT /timesheet-weeks/:employeeId/:weekStart'],
    call: (employeeId, weekStart, rows) => ({ params: { employeeId, weekStart }, body: { rows } }),
    args: (r) => [r.params.employeeId, r.params.weekStart, r.body.rows],
  },
  submitTimesheetWeek: {
    routes: ['POST /timesheet-weeks/:employeeId/:weekStart/submit'],
    call: (employeeId, weekStart) => ({ params: { employeeId, weekStart } }),
    args: (r) => [r.params.employeeId, r.params.weekStart],
  },
  recallTimesheetWeek: {
    routes: ['POST /timesheet-weeks/:employeeId/:weekStart/recall'],
    call: (employeeId, weekStart) => ({ params: { employeeId, weekStart } }),
    args: (r) => [r.params.employeeId, r.params.weekStart],
  },

  // ---------------- finance ----------------
  getInvoices: filtered('GET /invoices'),
  getInvoice: byId('GET /invoices/:id'),
  createInvoice: withBody('POST /invoices'),
  sendInvoice: byId('POST /invoices/:id/send'),
  recordPayment: {
    routes: ['POST /invoices/:id/payments'],
    // totalDue is the screen's figure; the real API computes the balance itself and ignores it.
    call: (id, p, totalDue) => ({ params: { id }, body: { ...p, totalDue } }),
    args: (r) => {
      const { totalDue, ...p } = r.body;
      return [r.params.id, p, totalDue];
    },
  },
  reviseInvoice: {
    routes: ['POST /invoices/:id/revise'],
    call: (id, reason, lines, discount) => ({ params: { id }, body: { reason, lines, discount } }),
    args: (r) => [r.params.id, r.body.reason, r.body.lines, r.body.discount],
  },
  getExpenses: filtered('GET /expenses'),
  getExpense: byId('GET /expenses/:id'),
  submitExpense: withBody('POST /expenses'),
  reopenExpense: {
    routes: ['POST /expenses/:id/reopen'],
    call: (id, reason, amount) => ({ params: { id }, body: { reason, amount } }),
    args: (r) => [r.params.id, r.body.reason, r.body.amount],
  },
  getBudgets: none('GET /budgets'),

  // ---------------- approvals & notifications ----------------
  getApprovals: filtered('GET /approvals'),
  decideApproval: {
    routes: ['POST /approvals/:id/decision'],
    call: (id, approve, comment) => ({ params: { id }, body: { approve, comment } }),
    args: (r) => [r.params.id, r.body.approve, r.body.comment],
  },
  approveMany: {
    routes: ['POST /approvals/bulk-decision'],
    call: (ids) => ({ body: { ids, approve: true } }),
    args: (r) => [r.body.ids],
  },
  getNotifications: none('GET /notifications'),
  markAllNotificationsRead: none('POST /notifications/read-all'),

  // ---------------- clients ----------------
  getLeads: none('GET /leads'),
  getLead: byId('GET /leads/:id'),
  moveLead: {
    routes: ['PATCH /leads/:id'],
    call: (id, stage) => ({ params: { id }, body: { stage } }),
    args: (r) => [r.params.id, r.body.stage],
  },
  getContracts: none('GET /contracts'),
  getTickets: oneQuery('GET /tickets', 'clientId'),
  getTicket: byId('GET /tickets/:id'),
  replyToTicket: {
    routes: ['POST /tickets/:id/messages'],
    call: (id, text, internal) => ({ params: { id }, body: { text, internal } }),
    args: (r) => [r.params.id, r.body.text, r.body.internal],
  },
  setTicketStatus: {
    routes: ['PATCH /tickets/:id'],
    call: (id, status) => ({ params: { id }, body: { status } }),
    args: (r) => [r.params.id, r.body.status],
  },
  getDocuments: {
    routes: ['GET /documents'],
    call: (ownerType, ownerId) => ({ query: { ownerType, ownerId } }),
    args: (r) => [r.query.ownerType, r.query.ownerId],
  },
  uploadVersion: {
    routes: ['POST /documents/:id/versions'],
    call: (id, note, fileId) => ({ params: { id }, body: { note, fileId } }),
    args: (r) => [r.params.id, r.body.note, r.body.fileId],
  },
  // The body is the file itself (client.ts sends a Blob as raw bytes, its name in X-Filename).
  uploadFile: {
    routes: ['POST /uploads'],
    call: (file) => ({ body: file }),
    args: (r) => [r.body],
  },
  getDocumentUrl: {
    routes: ['GET /documents/:id/versions/:version/download'],
    call: (id, version) => ({ params: { id, version: version ?? 'latest' } }),
    args: (r) => [r.params.id, r.params.version === 'latest' ? undefined : Number(r.params.version)],
  },

  // ---------------- workplace ----------------
  getAssets: none('GET /assets'),
  getMyAssets: none('GET /me/assets'),
  reportAssetIssue: {
    routes: ['POST /assets/:id/issues'],
    call: (id, text) => ({ params: { id }, body: { text } }),
    args: (r) => [r.params.id, r.body.text],
  },
  getAsset: byId('GET /assets/:id'),
  allocateAsset: {
    routes: ['POST /assets/:id/allocate'],
    call: (id, employeeId, note) => ({ params: { id }, body: { employeeId, note } }),
    args: (r) => [r.params.id, r.body.employeeId, r.body.note],
  },
  getInventory: none('GET /inventory'),
  moveStock: {
    routes: ['POST /inventory/:id/movements'],
    call: (id, kind, qty, note) => ({ params: { id }, body: { kind, qty, note } }),
    args: (r) => [r.params.id, r.body.kind, r.body.qty, r.body.note],
  },
  getRooms: none('GET /rooms'),
  getBookings: oneQuery('GET /bookings', 'date'),
  createBooking: withBody('POST /bookings'),
  getAnnouncements: none('GET /announcements'),
  acknowledge: byId('POST /announcements/:id/acknowledge'),
  getKbArticles: none('GET /kb'),
  getKbArticle: {
    routes: ['GET /kb/:slug'],
    call: (slug) => ({ params: { slug } }),
    args: (r) => [r.params.slug],
  },
  getVisitors: oneQuery('GET /visitors', 'date'),
  checkVisitor: {
    routes: ['POST /visitors/:id/check-in', 'POST /visitors/:id/check-out'],
    call: (id, action) => ({ route: action === 'in' ? 0 : 1, params: { id } }),
    args: (r) => [r.params.id, r.route === 1 ? 'out' : 'in'],
  },
  registerVisitor: {
    routes: ['POST /visitors'],
    call: (input, checkInNow) => ({ body: { ...input, checkInNow } }),
    args: (r) => {
      const { checkInNow, ...input } = r.body;
      return [input, checkInNow];
    },
  },

  // ---------------- admin ----------------
  getUsers: none('GET /users'),
  inviteUser: withBody('POST /users/invite'),
  resendInvite: byId('POST /users/:id/invite'),
  updateUser: idAndBody('PATCH /users/:id'),
  getRoles: none('GET /roles'),
  setPermission: {
    routes: ['PUT /roles/:id/permissions/:module'],
    call: (roleId, module, permission) => ({ params: { id: roleId, module }, body: { permission } }),
    args: (r) => [r.params.id, r.params.module, r.body.permission],
  },
  getWorkflows: none('GET /workflows'),
  getWorkflow: byId('GET /workflows/:id'),
  saveWorkflow: {
    routes: ['PUT /workflows/:id'],
    call: (w) => ({ params: { id: w.id }, body: w }),
    args: (r) => [{ ...r.body, id: r.params.id }],
  },
  getNotificationRules: none('GET /notification-rules'),
  setNotificationChannel: {
    routes: ['PATCH /notification-rules/:id'],
    call: (id, channel, on) => ({ params: { id }, body: { channel, on } }),
    args: (r) => [r.params.id, r.body.channel, r.body.on],
  },
  getAuditEvents: filtered('GET /audit'),
  getMasters: none('GET /masters'),
  saveMasterRow: {
    routes: ['PUT /masters/:id/rows/:rowId', 'POST /masters/:id/rows'],
    call: (listId, row): Req => (row.id ? { params: { id: listId, rowId: row.id }, body: row } : { route: 1, params: { id: listId }, body: row }),
    args: (r) => [r.params.id, r.params.rowId ? { ...r.body, id: r.params.rowId } : r.body],
  },
  getSystemJobs: none('GET /system-jobs'),

  // ---------------- session & public ----------------
  getMe: none('GET /me'),
  login: {
    routes: ['POST /auth/login'],
    call: (email, password) => ({ body: { email, password } }),
    args: (r) => [r.body.email, r.body.password],
  },
  logout: none('POST /auth/logout'),
  requestPasswordReset: {
    routes: ['POST /auth/forgot'],
    call: (email) => ({ body: { email } }),
    args: (r) => [r.body.email],
  },
  checkSetupToken: {
    routes: ['GET /setup/:token'],
    call: (token) => ({ params: { token } }),
    args: (r) => [r.params.token],
  },
  checkResetToken: {
    routes: ['GET /auth/reset/:token'],
    call: (token) => ({ params: { token } }),
    args: (r) => [r.params.token],
  },
  completeReset: {
    routes: ['POST /auth/reset/:token'],
    call: (token, password) => ({ params: { token }, body: { password } }),
    args: (r) => [r.params.token, r.body.password],
  },
  completeSetup: {
    routes: ['POST /setup/:token'],
    call: (token, input) => ({ params: { token }, body: input }),
    args: (r) => [r.params.token, r.body],
  },
  requestDemo: withBody('POST /demo-requests'),

  // ---------------- dashboard ----------------
  getDashboardFacts: oneQuery('GET /dashboard-facts', 'role'),
  getDashboardBlocks: {
    routes: ['GET /dashboard-blocks'],
    call: (metric, range, colour) => ({ query: { metric, range, colour } }),
    args: (r) => [r.query.metric, r.query.range, r.query.colour],
  },

  // ---------------- client portal ----------------
  getPortalSession: none('GET /portal/session'),
  getPortalProjects: none('GET /portal/projects'),
  getPortalProject: byId('GET /portal/projects/:id'),
  getPortalInvoices: none('GET /portal/invoices'),
  getPortalInvoice: byId('GET /portal/invoices/:id'),
  payPortalInvoice: {
    routes: ['POST /portal/invoices/:id/pay'],
    call: (id, method) => ({ params: { id }, body: { method } }),
    args: (r) => [r.params.id, r.body.method],
  },
  getPortalTickets: none('GET /portal/tickets'),
  getPortalTicket: byId('GET /portal/tickets/:id'),
  raisePortalTicket: withBody('POST /portal/tickets'),
  replyPortalTicket: {
    routes: ['POST /portal/tickets/:id/messages'],
    call: (id, text) => ({ params: { id }, body: { text } }),
    args: (r) => [r.params.id, r.body.text],
  },
  getPortalDocuments: none('GET /portal/documents'),
  getPortalDocumentUrl: byId('GET /portal/documents/:id/download'),
};

// ---------------- query strings ----------------
// Filters are flat objects of strings, numbers, booleans and id lists. On the wire: numbers and booleans as
// text, lists comma-separated (an empty list is sent as `ids=`, which means "none", unlike leaving it out,
// which means "any"). undefined and null are left out.

/** Keys whose values are numbers, booleans or lists, so the mock can decode them back to the type. */
const NUMBER_KEYS = new Set(['page', 'pageSize']);
const BOOLEAN_KEYS = new Set(['billable']);
const LIST_KEYS = new Set(['ids', 'employeeIds']);

export function encodeQuery(query: object | undefined): string {
  if (!query) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    qs.append(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = qs.toString();
  return s ? '?' + s : '';
}

export function decodeQuery(qs: URLSearchParams): Incoming['query'] {
  const out: Incoming['query'] = {};
  for (const [k, v] of qs) {
    if (NUMBER_KEYS.has(k)) out[k] = Number(v);
    else if (BOOLEAN_KEYS.has(k)) out[k] = v === 'true';
    else if (LIST_KEYS.has(k)) out[k] = v ? v.split(',') : [];
    else out[k] = v;
  }
  return out;
}
