# Riona frontend — backend handoff

This is the contract between the React frontend in `app/` and the API it expects. The repository
inventory, the hook table and the type list below were **generated from the source** on the day this file was written,
so they match the code as it stands. If you change a repository function, regenerate them rather than hand-editing.

Nothing in this app talks to a network. Every repository function resolves against an in-memory, deterministic
fixture "server". Swapping it for a real API means rewriting the repository function bodies, nothing else.

---

## 1. How the layers fit

```
screens / components ──► hooks (useQuery + invalidate, src/lib/query.ts)
                              │
                              ▼
                     src/data/repositories/*.ts   ◄── the swap point: one function per endpoint
                              │
                              ▼  (fixture only — delete when the API exists)
          src/data/repositories/_store.ts  +  src/data/seed/*.ts
```

- **Screens never import the seed or the store.** `src/data/__tests__/boundary.test.ts` fails the build's test run
  if anything outside `data/repositories` imports `data/seed` or `_store`, and checks that every exported repository
  function returns a Promise.
- **Selectors** (`src/data/selectors/*.ts`) are pure functions over domain types: payslip maths, GST split, ageing,
  profitability, leave balances, working days, Form 16 projection, approval descriptions, the dashboard facts.
  They run in the browser today. Several should move server-side; see section 6.
- **Query cache** (`src/lib/query.ts`): `useQuery(key, fn)` where `key[0]` is the domain; `invalidate(...domains)`
  marks every cached query in those domains stale. Mutations call `invalidate` with what they touched.
- **Errors**: the fixture rejects with `ApiError(status, message)` (exported from the barrel). Screens show
  `error.message` verbatim, so **the API's error messages are user-facing copy**. Keep them in the same plain voice
  (for example, `"Give a reason for rejecting."`, `"That email and password don’t match."`).

### Where the seed plugs out

1. In each `src/data/repositories/<domain>.ts`, replace the body of each function with a `fetch` to the endpoint in its
   JSDoc (also in the tables below). Keep the signature and the resolved type.
2. Map non-2xx responses to `new ApiError(status, message)`, so screens keep showing the message.
3. Delete `src/data/repositories/_store.ts` and `src/data/seed/`. The `resetDb` test hook and
   `src/data/__tests__/reconciliation.test.ts` go with them: that test checks the seed's internal consistency.
   Re-point the same identities at a staging dataset if you want to keep them.
4. `respond()` returns a `structuredClone` of the server state, so screens already treat responses as immutable copies.
   Nothing relies on shared references.

The fixture adds 160 ms of latency (0 under vitest) so loading states are real. The sign-in, password-reset,
setup, demo-request and payment stubs add 500–1,200 ms so their busy states are visible.

---

## 2. Things the fixture enforces that the API must too

These rules are implemented in the repository bodies. They are not obvious from the signatures, and the UI relies on them.

- **Approvals** (`decideApproval`): only the current step's approver may decide (403 otherwise), and rejecting
  needs a comment longer than two characters (422). The final approval applies the outcome to the source
  record: leave status, expense status, timesheet week and its entries (and a revision row), attendance regularisation
  (keeping `regularisedFrom`), invoice → `Sent`, profile change → written onto the employee. Every decision is audited.
- **Every mutation writes an audit event** (`audit()` in `_store.ts`), with field-level before/after where it matters.
  The Admin › Audit log screen is read-only and expects this.
- **Invoices are built server-side from entry ids** (`createInvoice`): the client sends `entryIds` and `expenseIds`,
  and the server groups them into lines by project and person. An entry counts as billed when a line on any non-void
  invoice references it, so there is no "billed" flag on the entry. The server rejects entries already billed
  (409, "invoiced in the meantime") and entries that aren't approved, billable hours for that client (422).
- **Invoice revisions** (`reviseInvoice`, screen `/app/finance/invoices/:id/revise`): only Sent, Overdue or
  Partially paid invoices (409 otherwise). A reason is required (422), and the client sees it. At least one line must
  remain. The revised total can't fall below what has been paid (422). The server recomputes line amounts. The first
  revision also stores the invoice as issued, so `revisions[0]` is always the original. Removing a time line frees its
  entries to be billed again, because "billed" is derived from invoice lines.
- **Append-only salary ledger**: `SalaryEvent`s are never updated. Corrections are new events with `appliesTo`
  months. The payslip selector builds "as corrected" vs "as paid at the time" from `effective` vs `recorded`
  (payroll locks on the 25th).
- **The dual-state pattern** applies wherever a record is amended. The UI shows the record both ways, so the API must
  keep the earlier state:
  - a revised invoice keeps `revisions[]` (shown as "as revised / as first issued", in Finance and in the portal);
  - a reopened expense keeps `revisions[]` ("as reopened / as first approved");
  - a timesheet week keeps `revisions[]`, **each with the entries as they stood** at that submit, rejection or
    approval. "As first submitted" re-renders the earlier grid from them.
  - payslips use "as corrected / as paid at the time", built from the ledger (above).
- **Room bookings** refuse overlaps (409). **Stock out** can't take more than is in stock (422). A timesheet week
  that is submitted or approved can't be saved (409) until it is recalled.
- **`revealBankAccount`** returns the full number and writes an audit event. The profile otherwise only ever has `accountLast4`.
- **Client portal scoping** (`repositories/portal.ts`): every portal function is scoped to the signed-in client
  **on the server** and returns client-safe projections (`PortalProject`, `PortalInvoice`, `PortalTicket`,
  `PortalDocument`). Projects carry progress, phases and milestones only: no team, assignees, tasks or hours.
  Tickets drop internal messages and the assignee. Documents are filtered to `visibleToClient`. Don't return
  the internal types to the portal and filter in the browser.
- **Self-service profile** (`updateMyProfile`, `requestProfileChange`): phone, personal email, blood group and the
  emergency contact change immediately. Legal name, address, marital status, bank account and PAN create a
  `ProfileChange` plus a `Profile change` approval routed to HR, and the employee record changes only when HR approves.
  Only one pending change per field (409).
- **My Space reads are scoped to the signed-in person**: `getMyAssets`, `getMyProfileChanges`, and the
  `employeeId`/`assigneeId` filters passed by the My Space screens. The API should take the person from the session,
  not trust a client-supplied id, for these.

---

## 3. Repository inventory

`Consumed by` lists the files that call the function directly, either as `api.fn` or as a named import.
Many reads are consumed through a hook instead; those show `hooks/data.ts`, and section 4 maps the hooks to screens.

### `repositories/people.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getEmployees` | `GET /employees?search&dept&location&status&managerId&type&page&pageSize&sort&dir` | `getEmployees(filter: EmployeeFilter = {}): Promise<Paginated<Employee>>` | `hooks/data.ts` |
| `getEmployee` | `GET /employees/:id` | `getEmployee(id: string): Promise<Employee>` | `screens/people/EmployeeForm.tsx`, `screens/people/Profile.tsx` |
| `updateEmployee` | `PATCH /employees/:id` | `updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee>` | `screens/people/Directory.tsx`, `screens/people/EmployeeForm.tsx`, `screens/people/Profile.tsx` |
| `revealBankAccount` | `POST /employees/:id/bank/reveal` | `revealBankAccount(id: string): Promise<{ account: string }>`<br>returns the full account number and writes an audit event | `screens/people/Profile.tsx` |
| `getSalaryEvents` | `GET /employees/:id/salary-events` | `getSalaryEvents(employeeId: string): Promise<SalaryEvent[]>`<br>append-only | `screens/me/Payslips.tsx`, `screens/people/Profile.tsx` |
| `getAllSalaryEvents` | `GET /salary-events?employeeIds` | `getAllSalaryEvents(): Promise<SalaryEvent[]>`<br>every ledger, for cost rates (restricted to Finance/Admin) | `hooks/data.ts`, `screens/people/Directory.tsx` |
| `appendSalaryEvent` | `POST /employees/:id/salary-events` | `appendSalaryEvent(ev: Omit<SalaryEvent, 'id' \| 'recorded' \| 'actorId'>): Promise<SalaryEvent>` | _not called by any screen yet_ |
| `getAttendance` | `GET /attendance?employeeId&from&to` | `getAttendance(filter: AttendanceFilter): Promise<AttendanceDay[]>` | `hooks/data.ts`, `screens/me/MySpace.tsx`, `screens/me/Payslips.tsx`, `screens/people/Profile.tsx` |
| `getHolidays` | `GET /holidays` | `getHolidays(): Promise<Holiday[]>` | `hooks/data.ts`, `screens/me/MySpace.tsx`, `screens/people/Leave.tsx`, `screens/work/WorkCalendar.tsx` |
| `getRegularisations` | `GET /regularisations?employeeId` | `getRegularisations(filter: { employeeId?: string } = {}): Promise<RegularisationRequest[]>` | `screens/me/MySpace.tsx` |
| `requestRegularisation` | `POST /regularisations` | `requestRegularisation(input: Pick<RegularisationRequest, 'date' \| 'requestedMark' \| 'requestedIn' \| 'requestedOut' \| 'reason'>): Promise<RegularisationRequest>` | `screens/me/MySpace.tsx` |
| `getLeaveTypes` | `GET /leave-types` | `getLeaveTypes(): Promise<LeaveType[]>` | `hooks/data.ts`, `screens/me/MySpace.tsx`, `screens/people/Profile.tsx` |
| `getLeaveRequests` | `GET /leave-requests?employeeId&status&from&to` | `getLeaveRequests(filter: LeaveFilter = {}): Promise<LeaveRequest[]>` | `hooks/data.ts`, `screens/me/MySpace.tsx`, `screens/people/Profile.tsx` |
| `applyLeave` | `POST /leave-requests` | `applyLeave(input: { type: LeaveTypeCode; from: string; to: string; reason: string; days: number }): Promise<LeaveRequest>` | `screens/me/MySpace.tsx` |
| `cancelLeave` | `POST /leave-requests/:id/cancel` | `cancelLeave(id: string): Promise<LeaveRequest>` | `screens/me/MySpace.tsx` |
| `getPayrollRuns` | `GET /payroll-runs` | `getPayrollRuns(): Promise<PayrollRun[]>` | `hooks/data.ts`, `screens/me/Payslips.tsx`, `screens/people/Payroll.tsx` |
| `getPayrollRun` | `GET /payroll-runs/:id` | `getPayrollRun(id: string): Promise<PayrollRun>` | `screens/people/Payroll.tsx` |
| `advancePayrollRun` | `POST /payroll-runs/:id/advance` | `advancePayrollRun(id: string): Promise<PayrollRun>`<br>moves to the next stage | `screens/people/Payroll.tsx` |
| `getSalaryStructures` | `GET /salary-structures` | `getSalaryStructures(): Promise<SalaryStructure[]>` | `screens/people/Payroll.tsx` |
| `saveSalaryStructure` | `PUT /salary-structures/:id` | `saveSalaryStructure(s: SalaryStructure): Promise<SalaryStructure>` | `screens/people/Payroll.tsx` |
| `getFilings` | `GET /statutory-filings` | `getFilings(): Promise<StatutoryFiling[]>` | `screens/people/Payroll.tsx` |
| `getJobs` | `GET /jobs` | `getJobs(): Promise<Job[]>` | `hooks/data.ts`, `screens/people/PeopleOps.tsx` |
| `getJob` | `GET /jobs/:id` | `getJob(id: string): Promise<Job>` | `screens/people/PeopleOps.tsx` |
| `getCandidates` | `GET /candidates?jobId` | `getCandidates(jobId?: string): Promise<Candidate[]>` | `hooks/data.ts`, `screens/people/PeopleOps.tsx` |
| `getCandidate` | `GET /candidates/:id` | `getCandidate(id: string): Promise<Candidate>` | `screens/people/PeopleOps.tsx` |
| `moveCandidate` | `PATCH /candidates/:id { stage }` | `moveCandidate(id: string, stage: CandidateStage): Promise<Candidate>` | `screens/people/PeopleOps.tsx` |
| `getOnboarding` | `GET /onboarding` | `getOnboarding(): Promise<OnboardingCase[]>` | `hooks/data.ts`, `screens/people/PeopleOps.tsx` |
| `getOnboardingCase` | `GET /onboarding/:id` | `getOnboardingCase(id: string): Promise<OnboardingCase>` | `screens/people/PeopleOps.tsx` |
| `setChecklistItem` | `PATCH /onboarding/:id/items/:itemId { done }` | `setChecklistItem(caseId: string, itemId: string, done: boolean): Promise<OnboardingCase>` | `screens/people/PeopleOps.tsx` |
| `getReviewCycles` | `GET /review-cycles` | `getReviewCycles(): Promise<ReviewCycle[]>` | `screens/people/PeopleOps.tsx`, `screens/people/Profile.tsx` |
| `getReviews` | `GET /reviews?cycleId&employeeId` | `getReviews(filter: { cycleId?: string; employeeId?: string } = {}): Promise<Review[]>` | `hooks/data.ts`, `screens/people/PeopleOps.tsx`, `screens/people/Profile.tsx` |
| `getReview` | `GET /reviews/:id` | `getReview(id: string): Promise<Review>` | `screens/people/PeopleOps.tsx` |
| `saveReview` | `PUT /reviews/:id` | `saveReview(id: string, patch: Pick<Review, 'selfAnswers' \| 'managerAnswers' \| 'rating' \| 'status'>): Promise<Review>` | `screens/people/PeopleOps.tsx` |
| `getGoals` | `GET /goals?employeeId` | `getGoals(employeeId?: string): Promise<Goal[]>` | `screens/people/PeopleOps.tsx`, `screens/people/Profile.tsx` |
| `getProgrammes` | `GET /training/programmes` | `getProgrammes(): Promise<TrainingProgramme[]>` | `screens/people/PeopleOps.tsx` |
| `getCertifications` | `GET /training/certifications?employeeId` | `getCertifications(employeeId?: string): Promise<Certification[]>` | `hooks/data.ts`, `screens/people/PeopleOps.tsx` |
| `createEmployee` | `POST /employees` | `createEmployee(input: NewEmployeeInput): Promise<Employee>`<br>creates the record, the hiring salary event and a joining checklist | `screens/people/EmployeeForm.tsx` |
| `updateMyProfile` | `PATCH /me/profile` | `updateMyProfile(patch: SelfServicePatch): Promise<Employee>`<br>self-service fields apply immediately and are audited | `screens/me/MySpace.tsx` |
| `getMyProfileChanges` | `GET /me/profile-changes` | `getMyProfileChanges(): Promise<ProfileChange[]>`<br>this person's requests for HR-approved fields | `screens/me/MySpace.tsx` |
| `requestProfileChange` | `POST /me/profile-changes` | `requestProfileChange(field: ProfileChangeField, after: string, reason: string): Promise<ProfileChange>`<br>routes to HR; the employee record changes only on approval | `screens/me/MySpace.tsx` |

### `repositories/work.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getClients` | `GET /clients` | `getClients(): Promise<Client[]>` | `hooks/data.ts` |
| `getClient` | `GET /clients/:id` | `getClient(id: string): Promise<Client>` | `screens/clients/Clients.tsx` |
| `getProjects` | `GET /projects?search&clientId&managerId&status&memberId` | `getProjects(filter: ProjectFilter = {}): Promise<Paginated<Project>>` | `hooks/data.ts` |
| `getProject` | `GET /projects/:id` | `getProject(id: string): Promise<Project>` | `screens/work/Projects.tsx` |
| `getTasks` | `GET /tasks?projectId&assigneeId&status` | `getTasks(filter: TaskFilter = {}): Promise<Task[]>` | `hooks/data.ts`, `screens/me/MySpace.tsx`, `screens/work/Projects.tsx` |
| `getTask` | `GET /tasks/:id` | `getTask(id: string): Promise<Task>` | `screens/work/Projects.tsx` |
| `updateTask` | `PATCH /tasks/:id` | `updateTask(id: string, patch: Partial<Pick<Task, 'status' \| 'assigneeId' \| 'due' \| 'priority' \| 'title' \| 'description' \| 'subtasks'>>): Promise<Task>` | `screens/me/MySpace.tsx`, `screens/work/Projects.tsx` |
| `createTask` | `POST /projects/:id/tasks` | `createTask(projectId: string, input: Pick<Task, 'title' \| 'assigneeId' \| 'due' \| 'priority' \| 'estimateHours'>): Promise<Task>` | `screens/work/Projects.tsx` |
| `addComment` | `POST /tasks/:id/comments` | `addComment(taskId: string, text: string): Promise<Task>` | `screens/work/Projects.tsx` |
| `getTimesheetEntries` | `GET /timesheet-entries?employeeId&projectId&clientId&from&to&status&billable&ids` | `getTimesheetEntries(filter: TimesheetFilter = {}): Promise<TimesheetEntry[]>` | `hooks/data.ts`, `screens/finance/FinanceScreens.tsx`, `screens/finance/NewInvoice.tsx`, `screens/work/Timesheets.tsx` |
| `getTimesheetWeeks` | `GET /timesheet-weeks?employeeId&weekStart&status` | `getTimesheetWeeks(filter: { employeeId?: string; weekStart?: string; status?: string } = {}): Promise<TimesheetWeek[]>` | `screens/work/Timesheets.tsx` |
| `saveTimesheetWeek` | `PUT /timesheet-weeks/:employeeId/:weekStart` | `saveTimesheetWeek(employeeId: string, weekStart: string, rows: WeekRowInput[]): Promise<TimesheetEntry[]>`<br>replaces the week's draft entries with these rows | `screens/work/Timesheets.tsx` |
| `submitTimesheetWeek` | `POST /timesheet-weeks/:employeeId/:weekStart/submit` | `submitTimesheetWeek(employeeId: string, weekStart: string): Promise<TimesheetWeek>`<br>locks the week and opens an approval | `screens/work/Timesheets.tsx` |
| `recallTimesheetWeek` | `POST /timesheet-weeks/:employeeId/:weekStart/recall` | `recallTimesheetWeek(employeeId: string, weekStart: string): Promise<TimesheetWeek>`<br>back to draft while still pending | `screens/work/Timesheets.tsx` |

### `repositories/finance.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getInvoices` | `GET /invoices?search&clientId&status&page&pageSize` | `getInvoices(filter: InvoiceFilter = {}): Promise<Paginated<Invoice>>` | `components/CommandPalette.tsx`, `hooks/data.ts` |
| `getInvoice` | `GET /invoices/:id` | `getInvoice(id: string): Promise<Invoice>` | `screens/finance/FinanceScreens.tsx`, `screens/finance/ReviseInvoice.tsx` |
| `createInvoice` | `POST /invoices` | `createInvoice(input: NewInvoiceInput): Promise<Invoice>`<br>the server builds lines from the selected approved entries and billable claims (one time line per project and person), so a line can never disagree with its sources | `screens/finance/NewInvoice.tsx` |
| `sendInvoice` | `POST /invoices/:id/send` | `sendInvoice(id: string): Promise<Invoice>` | `screens/finance/FinanceScreens.tsx` |
| `recordPayment` | `POST /invoices/:id/payments` | `recordPayment(id: string, p: { date: string; amount: number; method: Invoice['payments'][number]['method']; reference: string }, totalDue: number): Promise<Invoice>` | `screens/finance/FinanceScreens.tsx` |
| `reviseInvoice` | `POST /invoices/:id/revise { reason, lines, discount }` | `reviseInvoice(id: string, reason: string, lines: InvoiceLine[], discount: number): Promise<Invoice>`<br>amends an issued invoice. The earlier state is kept in `revisions` (the first entry is the invoice as issued), so the UI can show "as revised" and "as first issued". Line amounts are recomputed here from quantity × rate; lines keep their entry and expense links | `screens/finance/ReviseInvoice.tsx` |
| `getExpenses` | `GET /expenses?search&employeeId&clientId&projectId&status&billable&from&to` | `getExpenses(filter: ExpenseFilter = {}): Promise<Paginated<ExpenseClaim>>` | `hooks/data.ts`, `screens/me/MySpace.tsx` |
| `getExpense` | `GET /expenses/:id` | `getExpense(id: string): Promise<ExpenseClaim>` | `screens/finance/FinanceScreens.tsx` |
| `submitExpense` | `POST /expenses` | `submitExpense(input: NewExpenseInput): Promise<ExpenseClaim>` | `screens/finance/FinanceScreens.tsx` |
| `reopenExpense` | `POST /expenses/:id/reopen` | `reopenExpense(id: string, reason: string, amount: number): Promise<ExpenseClaim>`<br>keeps the approved state as a revision | `screens/finance/FinanceScreens.tsx` |
| `getBudgets` | `GET /budgets?fy` | `getBudgets(): Promise<Budget[]>` | `hooks/data.ts`, `screens/finance/FinanceScreens.tsx` |

### `repositories/approvals.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getApprovals` | `GET /approvals?type&status&approverId&requesterId` | `getApprovals(filter: ApprovalFilter = {}): Promise<ApprovalWithSource[]>`<br>each with its source record embedded | `hooks/data.ts` |
| `decideApproval` | `POST /approvals/:id/decision { approve, comment }` | `decideApproval(id: string, approve: boolean, comment?: string): Promise<ApprovalWithSource>`<br>Rejection needs a comment. The final approval applies the outcome to the source record | `hooks/actions.ts` |
| `approveMany` | `POST /approvals/bulk-decision { ids, approve }` | `approveMany(ids: string[]): Promise<number>` | `hooks/actions.ts` |
| `getNotifications` | `GET /notifications` | `getNotifications(): Promise<Notification[]>` | `hooks/data.ts` |
| `markAllNotificationsRead` | `POST /notifications/read-all` | `markAllNotificationsRead(): Promise<void>` | `components/Notifications.tsx` |

### `repositories/clients.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getLeads` | `GET /leads` | `getLeads(): Promise<Lead[]>` | `hooks/data.ts`, `screens/clients/Clients.tsx` |
| `getLead` | `GET /leads/:id` | `getLead(id: string): Promise<Lead>` | `screens/clients/Clients.tsx` |
| `moveLead` | `PATCH /leads/:id { stage }` | `moveLead(id: string, stage: LeadStage): Promise<Lead>` | `screens/clients/Clients.tsx` |
| `getContracts` | `GET /contracts` | `getContracts(): Promise<Contract[]>` | `hooks/data.ts`, `screens/clients/Clients.tsx` |
| `getTickets` | `GET /tickets?clientId` | `getTickets(clientId?: string): Promise<Ticket[]>` | `components/CommandPalette.tsx`, `hooks/data.ts`, `screens/clients/Clients.tsx` |
| `getTicket` | `GET /tickets/:id` | `getTicket(id: string): Promise<Ticket>` | `screens/clients/Clients.tsx` |
| `replyToTicket` | `POST /tickets/:id/messages { text, internal }` | `replyToTicket(id: string, text: string, internal: boolean): Promise<Ticket>` | `screens/clients/Clients.tsx` |
| `setTicketStatus` | `PATCH /tickets/:id { status }` | `setTicketStatus(id: string, status: Ticket['status']): Promise<Ticket>` | `screens/clients/Clients.tsx` |
| `getDocuments` | `GET /documents?ownerType&ownerId` | `getDocuments(ownerType: Document['ownerType'], ownerId?: string): Promise<Document[]>` | `components/DocumentTable.tsx` |
| `uploadVersion` | `POST /documents/:id/versions` | `uploadVersion(id: string, note: string): Promise<Document>` | `components/DocumentTable.tsx` |
| `getDocumentUrl` | `GET /documents/:id/versions/:version/download` | `getDocumentUrl(id: string, version?: number): Promise<{ url: string; filename: string }>`<br>returns a short-lived URL | `components/DocumentTable.tsx` |

### `repositories/workplace.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getAssets` | `GET /assets` | `getAssets(): Promise<Asset[]>` | `hooks/data.ts`, `screens/people/Profile.tsx`, `screens/workplace/Workplace.tsx` |
| `getMyAssets` | `GET /me/assets` | `getMyAssets(): Promise<Asset[]>`<br>items currently allocated to the signed-in person | `screens/me/MySpace.tsx` |
| `reportAssetIssue` | `POST /assets/:id/issues` | `reportAssetIssue(id: string, text: string): Promise<Asset>`<br>the holder reports a problem; IT sees it on the asset | `screens/me/MySpace.tsx` |
| `getAsset` | `GET /assets/:id` | `getAsset(id: string): Promise<Asset>` | `screens/workplace/Workplace.tsx` |
| `allocateAsset` | `POST /assets/:id/allocate { employeeId }` | `allocateAsset(id: string, employeeId: string \| null, note: string): Promise<Asset>`<br>closes any open allocation first | `screens/workplace/Workplace.tsx` |
| `getInventory` | `GET /inventory` | `getInventory(): Promise<InventoryItem[]>` | `hooks/data.ts`, `screens/workplace/Workplace.tsx` |
| `moveStock` | `POST /inventory/:id/movements { kind, qty, note }` | `moveStock(id: string, kind: 'in' \| 'out', qty: number, note: string): Promise<InventoryItem>` | `screens/workplace/Workplace.tsx` |
| `getRooms` | `GET /rooms` | `getRooms(): Promise<Room[]>` | `screens/work/WorkCalendar.tsx`, `screens/workplace/Workplace.tsx` |
| `getBookings` | `GET /bookings?date` | `getBookings(date: string): Promise<Booking[]>` | `hooks/data.ts`, `screens/work/WorkCalendar.tsx`, `screens/workplace/Workplace.tsx` |
| `createBooking` | `POST /bookings` | `createBooking(b: Omit<Booking, 'id' \| 'bookedById'>): Promise<Booking>`<br>refuses overlaps | `screens/workplace/Workplace.tsx` |
| `getAnnouncements` | `GET /announcements` | `getAnnouncements(): Promise<Announcement[]>` | `hooks/data.ts`, `screens/workplace/Workplace.tsx` |
| `acknowledge` | `POST /announcements/:id/acknowledge` | `acknowledge(id: string): Promise<Announcement>` | `screens/workplace/Workplace.tsx` |
| `getKbArticles` | `GET /kb` | `getKbArticles(): Promise<KbArticle[]>` | `components/CommandPalette.tsx`, `hooks/data.ts`, `screens/workplace/Workplace.tsx` |
| `getKbArticle` | `GET /kb/:slug` | `getKbArticle(slug: string): Promise<KbArticle>` | `screens/workplace/Workplace.tsx` |
| `getVisitors` | `GET /visitors?date` | `getVisitors(date?: string): Promise<Visitor[]>` | `hooks/data.ts`, `screens/workplace/Workplace.tsx` |
| `checkVisitor` | `POST /visitors/:id/check-in` | `checkVisitor(id: string, action: 'in' \| 'out'): Promise<Visitor>`<br>| check-out (kiosk) | `screens/workplace/Workplace.tsx` |
| `registerVisitor` | `POST /visitors` | `registerVisitor(input: Pick<Visitor, 'name' \| 'company' \| 'hostId' \| 'purpose' \| 'date' \| 'expected'>, checkInNow: boolean): Promise<Visitor>`<br>(kiosk walk-in or pre-registration) | `screens/workplace/Workplace.tsx` |

### `repositories/admin.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getUsers` | `GET /users` | `getUsers(): Promise<AppUser[]>` | `hooks/data.ts`, `screens/admin/Admin.tsx` |
| `inviteUser` | `POST /users/invite` | `inviteUser(input: { name: string; email: string; role: string }): Promise<AppUser>` | `screens/admin/Admin.tsx` |
| `updateUser` | `PATCH /users/:id { status \| role }` | `updateUser(id: string, patch: Partial<Pick<AppUser, 'status' \| 'role'>>): Promise<AppUser>` | `screens/admin/Admin.tsx` |
| `getRoles` | `GET /roles` | `getRoles(): Promise<RoleDef[]>` | `screens/admin/Admin.tsx` |
| `setPermission` | `PUT /roles/:id/permissions/:module { permission }` | `setPermission(roleId: string, module: string, perm: Permission): Promise<RoleDef>` | `screens/admin/Admin.tsx` |
| `getWorkflows` | `GET /workflows` | `getWorkflows(): Promise<Workflow[]>` | `hooks/data.ts`, `screens/admin/Admin.tsx` |
| `getWorkflow` | `GET /workflows/:id` | `getWorkflow(id: string): Promise<Workflow>` | `screens/admin/Admin.tsx` |
| `saveWorkflow` | `PUT /workflows/:id` | `saveWorkflow(w: Workflow): Promise<Workflow>` | `screens/admin/Admin.tsx` |
| `getNotificationRules` | `GET /notification-rules` | `getNotificationRules(): Promise<NotificationRule[]>` | `screens/admin/Admin.tsx` |
| `setNotificationChannel` | `PATCH /notification-rules/:id { channels }` | `setNotificationChannel(id: string, channel: keyof NotificationRule['channels'], on: boolean): Promise<NotificationRule>` | `screens/admin/Admin.tsx` |
| `getAuditEvents` | `GET /audit?search&entity&actorId&from&to&page&pageSize` | `getAuditEvents(filter: AuditFilter = {}): Promise<Paginated<AuditEvent>>`<br>read-only; there is no delete endpoint | `hooks/data.ts`, `screens/admin/Admin.tsx`, `screens/people/Directory.tsx` |
| `getMasters` | `GET /masters` | `getMasters(): Promise<MasterList[]>` | `screens/admin/Admin.tsx` |
| `saveMasterRow` | `PUT /masters/:id/rows/:rowId` | `saveMasterRow(listId: string, row: { id?: string; values: string[]; active: boolean }): Promise<MasterList>`<br>| POST /masters/:id/rows | `screens/admin/Admin.tsx` |
| `getSystemJobs` | `GET /system-jobs` | `getSystemJobs(): Promise<SystemJob[]>` | `hooks/data.ts`, `screens/admin/Admin.tsx` |

### `repositories/session.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getMe` | `GET /me` | `getMe(): Promise<{ employee: Employee; today: string; orgName: string }>`<br>the signed-in person and today’s date on the server | `hooks/data.ts` |
| `login` | `POST /auth/login` | `login(email: string, password: string): Promise<{ ok: true }>`<br>stub. Any password of 8+ characters "works"; "wrongpass" shows the error state | `public/Auth.tsx` |
| `requestPasswordReset` | `POST /auth/forgot` | `requestPasswordReset(email: string): Promise<{ ok: true }>`<br>stub | `public/Auth.tsx` |
| `checkSetupToken` | `GET /setup/:token` | `checkSetupToken(token: string): Promise<{ orgName: string; email: string }>`<br>stub. Tokens starting with "expired" are rejected | `public/Auth.tsx` |
| `completeSetup` | `POST /setup/:token` | `completeSetup(_token: string, input: SetupInput): Promise<{ ok: true }>`<br>stub | `public/Auth.tsx` |
| `requestDemo` | `POST /demo-requests` | `requestDemo(input: { name: string; email: string; company: string; size: string }): Promise<{ ok: true }>`<br>stub | `public/PublicSite.tsx` |

### `repositories/portal.ts`

| Function | Endpoint | Signature | Consumed by |
|---|---|---|---|
| `getPortalSession` | `GET /portal/session` | `getPortalSession(): Promise<PortalSession>` | `portal/Portal.tsx` |
| `getPortalProjects` | `GET /portal/projects` | `getPortalProjects(): Promise<PortalProject[]>` | `portal/Portal.tsx` |
| `getPortalProject` | `GET /portal/projects/:id` | `getPortalProject(id: string): Promise<PortalProject>` | `portal/Portal.tsx` |
| `getPortalInvoices` | `GET /portal/invoices` | `getPortalInvoices(): Promise<PortalInvoice[]>` | `portal/Portal.tsx` |
| `getPortalInvoice` | `GET /portal/invoices/:id` | `getPortalInvoice(id: string): Promise<PortalInvoice>` | `portal/Portal.tsx` |
| `payPortalInvoice` | `POST /portal/invoices/:id/pay` | `payPortalInvoice(id: string, method: 'UPI' \| 'NEFT'): Promise<PortalInvoice>`<br>stub for the payment gateway. A real gateway confirms by webhook; here the balance is settled after a delay and recorded against the invoice, as Finance would see it | `portal/Portal.tsx` |
| `getPortalTickets` | `GET /portal/tickets` | `getPortalTickets(): Promise<PortalTicket[]>` | `portal/Portal.tsx` |
| `getPortalTicket` | `GET /portal/tickets/:id` | `getPortalTicket(id: string): Promise<PortalTicket>` | `portal/Portal.tsx` |
| `raisePortalTicket` | `POST /portal/tickets` | `raisePortalTicket(input: { subject: string; text: string; priority: Ticket['priority']; projectId: string \| null }): Promise<PortalTicket>` | `portal/Portal.tsx` |
| `replyPortalTicket` | `POST /portal/tickets/:id/messages` | `replyPortalTicket(id: string, text: string): Promise<PortalTicket>` | `portal/Portal.tsx` |
| `getPortalDocuments` | `GET /portal/documents` | `getPortalDocuments(): Promise<PortalDocument[]>`<br>only documents shared with the client | `portal/Portal.tsx` |
| `getPortalDocumentUrl` | `GET /portal/documents/:id/download` | `getPortalDocumentUrl(id: string): Promise<{ url: string; filename: string }>`<br>latest shared version, as a short-lived URL | `portal/Portal.tsx` |


**Functions with no caller, classified**

| Function | Verdict | Why |
|---|---|---|
| `appendSalaryEvent` | **Wire when the backend exists** | It is the only write path into the salary ledger. The read side (payslips, payroll runs, Form 16, cost rates) is fully built on it. The UI that calls it, a "record a revision / bonus / correction" form on Profile › Compensation, is **not built**. That is a frontend gap to close alongside the endpoint. |
| `getApproval` | **Dead — deleted** | Every queue loads approvals with their source records embedded (`getApprovals`), and notifications link to the source record's own screen, never to an approval. Nothing needs one approval by id. Removed from `repositories/approvals.ts`; re-add `GET /approvals/:id` only if you introduce a deep link to a single approval. |
| `raiseTicket` | **Dead — deleted earlier** | The portal raises tickets with `raisePortalTicket`. No internal screen raises one on a client's behalf. |

**What the backend must do with `appendSalaryEvent` (`POST /employees/:id/salary-events`)**

The payslip, payroll-run, Form 16 and cost-rate calculations in `selectors/payroll.ts` all assume the following. If the
API breaks any of these rules, the "as corrected / as paid at the time" figures and margin stop being reproducible.

1. **Append only.** Insert, never update or delete. There is no `PATCH` or `DELETE` on salary events, and the table
   should refuse them: revoke the grants, or add a trigger. A mistake is fixed by appending a `Correction` (or a
   `Revised` with the right CTC), never by editing history.
2. **The server stamps `recorded` and `actorId`.** Take `recorded` from the server clock and `actorId` from the session,
   and never from the request body. The signature already omits both. `recorded` is what decides "as paid at the time".
   Payroll inputs lock on the 25th (`lockDateOf`), so an event recorded after its effective month's lock is paid as
   arrears in the next run, not in the month it applies to.
3. **Validate by type:**
   - `Hired`, `Revised`, `Promotion`: need `ctc > 0`.
   - `Bonus`, `Deduction`: need `amount > 0`.
   - `Correction`: needs `amount`, `component`, and `appliesTo` months that fall on or after the hire month and before the
     effective month.
   - `effective` is the first of a month, on or after `joined`.
   - There is exactly one `Hired` event, and it is the earliest.
4. **Closed runs never change.** A payroll run that is Approved or Disbursed keeps its figures. A later event changes
   only the "as corrected" view and the next run's arrears. Re-running `runLines` against a closed run must give the
   figures it was paid with. Each `PayrollRun` stores the `salaryEventIds` it included, and the run screen uses that list
   to flag events recorded after the lock as late.
5. **Permissions and audit:** only HR and Admin may append. Write an audit event with the type, effective date and
   before/after CTC. The fixture writes an audit event with the type only, and checks no permission, because there is no auth.
6. **Approval is your decision.** The fixture applies events immediately. If compensation changes need sign-off, add a
   `Compensation` approval type: the approval engine and `ApprovalQueue` take new types the way `Profile change` was added.

Every detail screen fetches its record by id: employee, project, task (both the full page and the board's side panel),
client account, invoice, expense, payroll run, onboarding case, review, job, candidate, lead, ticket, asset, KB article
and workflow. Lists are used only for lists and for name lookups.

---

## 4. Hooks → screens

Shared reads go through `src/hooks/data.ts`. This table shows which screens depend on each one, so you can see
what an endpoint change touches.

| Hook | Repository calls | Used by |
|---|---|---|
| `useMe` | `getMe` | `components/AccountMenu.tsx`, `components/ApprovalQueue.tsx`, `components/CommandPalette.tsx`, `components/Notifications.tsx`, `components/TopBar.tsx`, `screens/admin/Admin.tsx`, `screens/clients/Clients.tsx`, `screens/finance/FinanceScreens.tsx`, `screens/finance/NewInvoice.tsx`, `screens/me/MySpace.tsx`, `screens/me/Payslips.tsx`, `screens/people/Attendance.tsx`, `screens/people/Directory.tsx`, `screens/people/EmployeeForm.tsx`, `screens/people/Leave.tsx`, `screens/people/Payroll.tsx`, `screens/people/PeopleOps.tsx`, `screens/people/Profile.tsx`, `screens/work/Projects.tsx`, `screens/work/Timesheets.tsx`, `screens/work/WorkCalendar.tsx`, `screens/workplace/Workplace.tsx` |
| `useEmployees` | `getEmployees` | `App.tsx`, `components/ApprovalQueue.tsx`, `components/CommandPalette.tsx`, `components/DocumentTable.tsx`, `components/Notifications.tsx`, `components/Overlays.tsx`, `screens/admin/Admin.tsx`, `screens/clients/Clients.tsx`, `screens/finance/FinanceScreens.tsx`, `screens/finance/NewInvoice.tsx`, `screens/finance/ProfitEntries.tsx`, `screens/finance/Profitability.tsx`, `screens/me/MySpace.tsx`, `screens/people/Attendance.tsx`, `screens/people/Directory.tsx`, `screens/people/EmployeeForm.tsx`, `screens/people/Leave.tsx`, `screens/people/OrgChart.tsx`, `screens/people/Payroll.tsx`, `screens/people/PeopleOps.tsx`, `screens/people/Profile.tsx`, `screens/work/Projects.tsx`, `screens/work/Timesheets.tsx`, `screens/work/WorkCalendar.tsx`, `screens/workplace/Workplace.tsx` |
| `useClients` | `getClients` | `App.tsx`, `components/ApprovalQueue.tsx`, `components/CommandPalette.tsx`, `screens/clients/Clients.tsx`, `screens/finance/FinanceScreens.tsx`, `screens/finance/NewInvoice.tsx`, `screens/finance/ProfitEntries.tsx`, `screens/finance/Profitability.tsx`, `screens/finance/ReviseInvoice.tsx`, `screens/work/Projects.tsx`, `screens/work/Timesheets.tsx` |
| `useProjects` | `getProjects` | `App.tsx`, `components/ApprovalQueue.tsx`, `components/CommandPalette.tsx`, `components/Notifications.tsx`, `screens/clients/Clients.tsx`, `screens/finance/FinanceScreens.tsx`, `screens/finance/NewInvoice.tsx`, `screens/finance/ProfitEntries.tsx`, `screens/finance/Profitability.tsx`, `screens/me/MySpace.tsx`, `screens/work/Projects.tsx`, `screens/work/Timesheets.tsx`, `screens/work/WorkCalendar.tsx` |
| `useApprovals` | `getApprovals` | `components/ApprovalQueue.tsx`, `components/CommandPalette.tsx`, `components/Notifications.tsx`, `components/Overlays.tsx`, `screens/finance/FinanceScreens.tsx`, `screens/work/Timesheets.tsx` |
| `useNotifications` | `getNotifications` | `components/Notifications.tsx` |
| `useAllEntries` | `getTimesheetEntries` | `screens/clients/Clients.tsx`, `screens/finance/ProfitEntries.tsx`, `screens/finance/Profitability.tsx`, `screens/work/Projects.tsx` |
| `useAllInvoices` | `getInvoices` | `screens/clients/Clients.tsx`, `screens/finance/FinanceScreens.tsx`, `screens/finance/NewInvoice.tsx`, `screens/finance/ProfitEntries.tsx`, `screens/finance/Profitability.tsx`, `screens/work/Projects.tsx` |
| `useAllExpenses` | `getExpenses` | `screens/clients/Clients.tsx`, `screens/finance/FinanceScreens.tsx`, `screens/finance/NewInvoice.tsx`, `screens/finance/ProfitEntries.tsx`, `screens/finance/Profitability.tsx`, `screens/work/Projects.tsx` |
| `useAllSalaryEvents` | `getAllSalaryEvents` | `screens/clients/Clients.tsx`, `screens/finance/NewInvoice.tsx`, `screens/finance/ProfitEntries.tsx`, `screens/finance/Profitability.tsx`, `screens/people/Payroll.tsx`, `screens/work/Projects.tsx` |
| `useAllAttendance` | `getAttendance` | `screens/people/Attendance.tsx`, `screens/people/Payroll.tsx` |
| `useLeave` | `getLeaveRequests` | `screens/people/Leave.tsx`, `screens/work/WorkCalendar.tsx` |
| `useLeaveTypes` | `getLeaveTypes` | `screens/people/Leave.tsx` |
| `useTasks` | `getTasks` | `screens/work/WorkCalendar.tsx` |
| `useFacts` | `getAnnouncements`, `getAssets`, `getAuditEvents`, `getBookings`, `getBudgets`, `getCandidates`, `getCertifications`, `getContracts`, `getHolidays`, `getInventory`, `getJobs`, `getKbArticles`, `getLeads`, `getOnboarding`, `getPayrollRuns`, `getReviews`, `getSystemJobs`, `getTickets`, `getUsers`, `getVisitors`, `getWorkflows` | `screens/Dashboard.tsx`, `screens/Hub.tsx` |
| `useDecide` | `approveMany`, `decideApproval` | `components/ApprovalQueue.tsx`, `components/Notifications.tsx`, `components/Overlays.tsx` |

`useFacts` is the dashboards' and hubs' figure source. It loads **every collection** and computes all hub and
dashboard numbers in the browser (`selectors/facts.ts`). That works for the 60-person seed. Against a real
dataset it should become one `GET /dashboard-facts?role` endpoint returning the computed `Facts` object (its type
is exported from `selectors/facts.ts`).

---

## 5. Domain types

All in `src/data/types/index.ts`. Dates are `YYYY-MM-DD` strings, timestamps are ISO 8601, and money is INR rupees
as numbers (not paise).

- **General**: `ID`, `ISODate`, `ISODateTime`, `Paginated`, `PageQuery`, `Estimated`, `Role`
- **People**: `Department`, `EmploymentType`, `EmployeeStatus`, `Employee`, `EmployeeFilter`, `SalaryEventType`, `SalaryEvent`, `AttendanceMark`, `AttendanceDay`, `AttendanceFilter`, `Holiday`, `LeaveTypeCode`, `LeaveType`, `LeaveStatus`, `LeaveRequest`, `LeaveFilter`, `PayrollStage`, `PayrollRun`, `SalaryComponent`, `SalaryStructure`, `StatutoryFiling`
- **Recruitment, onboarding, performance, training**: `Job`, `CandidateStage`, `Candidate`, `OnboardingKind`, `ChecklistOwner`, `OnboardingCase`, `ReviewCycle`, `Review`, `Goal`, `TrainingProgramme`, `Certification`
- **Clients & work**: `Client`, `BillingModel`, `ProjectHealth`, `ProjectMember`, `Project`, `ProjectFilter`, `TaskStatus`, `TaskPriority`, `Task`, `TaskFilter`, `EntryStatus`, `TimesheetEntry`, `TimesheetFilter`, `TimesheetWeek`
- **Finance**: `InvoiceStatus`, `InvoiceLine`, `Invoice`, `InvoiceFilter`, `NewInvoiceInput`, `ExpenseCategory`, `ExpenseStatus`, `ExpenseClaim`, `ExpenseFilter`, `NewExpenseInput`, `Budget`
- **Clients extra**: `LeadStage`, `Lead`, `Contract`, `TicketPriority`, `Ticket`
- **Workplace**: `Asset`, `InventoryItem`, `Room`, `Booking`, `Announcement`, `KbArticle`, `Visitor`
- **Approvals**: `ApprovalType`, `ProfileChangeField`, `ProfileChange`, `ApprovalStatus`, `ApprovalStep`, `Approval`, `ApprovalSource`, `ApprovalWithSource`, `ApprovalFilter`, `RegularisationRequest`
- **Admin**: `AppUser`, `Permission`, `RoleDef`, `WorkflowNodeKind`, `WorkflowNode`, `Workflow`, `NotificationRule`, `AuditEvent`, `AuditFilter`, `MasterList`, `SystemJob`, `Notification`, `Document`, `Session`

Types that live beside their repository because only that API uses them:

- `repositories/portal.ts`: `PortalSession`, `PortalProject`, `PortalInvoice`, `PortalTicket`, `PortalDocument`. These are the client-safe projections.
- `repositories/people.ts`: `SelfServicePatch`.
- `repositories/session.ts`: `SetupInput`.

---

## 6. What should move to the server

These run in the browser today because the fixture made it convenient. The figures are correct, but each one needs
data a browser shouldn't hold at scale, or data it shouldn't hold at all.

| Today (browser) | Why it should move | Suggested endpoint |
|---|---|---|
| `selectors/facts.ts` via `useFacts` | Loads every collection | `GET /dashboard-facts?role` |
| `selectors/profitability.ts` + `useAllEntries` / `useAllSalaryEvents` | Every timesheet entry plus **every salary ledger**, to cost hours | `GET /profitability?period&scope` and `GET /profitability/entries?scope` (the drill-through) |
| `selectors/payroll.ts` `runLines` / `runTotals` | Every employee's ledger plus attendance | `GET /payroll-runs/:id/lines` |
| `selectors/payroll.ts` `payslip` (My Space, Profile) | Correct per person, but the ledger is sensitive | `GET /me/payslips/:month?view=corrected\|as-paid` returning the computed `Payslip` |
| `selectors/payroll.ts` `form16Projection` | Same | `GET /me/form16?fy` |
| `useEmployees` for name lookup | Loads all employees, including fields a manager or employee shouldn't see | A directory summary endpoint (`id`, `name`, `title`, `dept`, `managerId`) |
| `selectors/finance.ts` `invoiceTotals` | Fine in the browser, but the server must compute the same totals for the PDF and for payments | Return totals on `Invoice` |

`getAllSalaryEvents` is documented as Finance/Admin only. The browser doesn't enforce that: it hides the screens that
use it by role, but role comes from the URL (below).

---

## 7. Session, roles and auth (UI only)

- **There is no authentication.** `getMe()` always returns Dipak Sharma (E-0100). The role comes from `?role=` in the
  URL (`state/store.tsx`), and screens **hide** anything the role can't use rather than disabling it. A real session
  must supply both the person and the role, and the API must enforce access. Hiding a screen in the UI controls nothing.
- `login`, `requestPasswordReset`, `checkSetupToken`, `completeSetup`, `requestDemo` are stubs with real
  validation and error copy:
  - the password `wrongpass`, or anything under 8 characters, fails;
  - setup tokens starting with `expired` fail with 410;
  - the setup password needs at least 10 characters.
- On success, sign-in navigates to `?role=<role>#/app` (Employee → `#/app/me`). Sign out goes to `#/login`.
- `payPortalInvoice` stands in for the payment gateway. It settles the balance after a delay and records the payment
  on the invoice, which Finance then sees. A real gateway confirms by webhook. The portal should then poll or
  refetch `GET /portal/invoices/:id`.
- The portal session is fixed to Lumen Energy (C-31) in `repositories/portal.ts` (`PORTAL_CLIENT`). Northwind has
  no open invoices in the seed, so the Pay flow couldn't be shown with it.

---

## 8. Estimated figures

Any value the system can't state authoritatively renders an `est.` marker whose tooltip gives the basis
(`components/ui.tsx` `Est`). The API should keep flagging these, as `Estimated = { value, estimated: true, basis }`
or an equivalent field.

- **TDS** on payslips and in payroll runs: projected from the month's salary × 12 under the new regime, with no
  declarations applied. Net pay inherits the marker.
- **Cost rate** (CTC × 1.4 ÷ 12 ÷ 140 productive hours), and therefore labour cost and margin on the profitability screens.
- **Form 16 Part B** before the year closes: months before the current one are as paid; the rest are projected at the
  current salary.

---

## 9. Other gaps to know about

- **File uploads are not sent.** The expense receipt, the profile-change proof and the document "upload version"
  record only that a file was chosen (`receipt: boolean`) or append a version row. There is no upload endpoint.
  You'll need `POST /uploads` (or pre-signed URLs) and an id on the record.
- **Downloads return `data:` URLs** of plain text (`getDocumentUrl`, `getPortalDocumentUrl`; the payslip and portal
  invoice downloads are built in the browser). Real endpoints should return short-lived signed URLs to the PDF.
- **Ids** are generated by the fixture (`nextId`). Screens never invent ids; they navigate to whatever id the create
  call returns.
- **Today is fixed** at 6 Nov 2026 in the seed (`seed/calendar.ts`). `getMe().today` is the server's date. Screens use
  it, not the browser clock, for anything date-relative. A few display helpers (`lib/format.ts` `ago`, `lib/dates.ts`
  `NOW`, `TODAY_ISO`) also hard-code that date for relative labels, so replace them with the server date when you
  wire the API.

---

## 10. Routes

There are three apps behind one entry, split on the hash path in `src/App.tsx`:

- `#/app/...`: the internal app, with the top bar and one lazy chunk per hub. The inventory is in `scripts/routes.txt`.
- `#/portal/...`: the client portal (its own shell, lazy-loaded).
- everything else is the public site and auth pages:
  - `#/`, `#/features`, `#/features/:pillar`, `#/security`, `#/contact`, `#/docs`;
  - `#/login`, `#/forgot-password`, `#/setup/:token`.

`scripts/flows.ts` (`npm run flows <baseUrl>`) drives the product flows end to end, comparing the screen with figures
computed independently from the seed. It covers:
- building an inter-state invoice (lines, IGST, the margin panel, back-links to entries);
- scrubbing the compensation ledger, as corrected and as paid;
- revising an invoice;
- reviewing a resubmitted week;
- reopening a claim.

`scripts/a11y.cjs` (`npm run a11y <baseUrl>`) runs axe-core over twelve representative routes and fails on any serious
or critical violation. `npm run lint` enforces the React hook rules.

`scripts/gate.cjs` visits every route in `scripts/routes.txt` as each role at 1440 px and 390 px. It fails on console
errors, horizontal scroll or a route still loading after 8 s.
