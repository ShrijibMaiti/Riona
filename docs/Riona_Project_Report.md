## TITLE PAGE

**SOFTWARE PROJECT REPORT**

B.Tech 2nd Year – Computer Science and Engineering (Data Science)

Academic Session: 2026–2027

**Project Title: Riona — An Integrated Office Management System with Event-Sourced Payroll and Unified Time Accounting**

Submitted by:
1. Shrijib Maiti – Roll No. 56

Department of Computer Science and Engineering (Data Science)

University of Engineering & Management, Kolkata

---

## CHAPTER 1: ABSTRACT

Riona is a web-based office management system for a services company: one that employs staff, runs projects for clients and bills for time. It brings together human resource management, project execution, client relationship management, finance and office administration. These are delivered as twenty-nine functional modules in a single application.

Most office management systems keep payroll and client billing in separate subsystems. That makes it impossible to tell whether a given client or project is actually profitable. Riona solves this by treating a single timesheet entry as the source of three figures: the employee's payroll cost, the client's invoice line, and the project's margin. These figures are computed when they are read rather than stored, so they cannot drift away from the records behind them. The one deliberate exception is an issued invoice, whose totals are frozen at the moment of issue, as an invoice must be.

The system also stores salary as an append-only sequence of events rather than as editable rows. Any payslip can therefore be regenerated as it stood on any past date. Retroactive corrections and arrears become a matter of replaying events rather than editing history, and a complete audit trail comes as a by-product.

The frontend is built with React 18, Vite and TypeScript, and has 128 routes across five user roles. The backend is built with Node.js, the Fastify web framework and PostgreSQL 16. It serves all 137 data functions the interface uses, through 139 HTTP endpoints, with permission checks, an audit log written in the same transaction as every change, and row-level security for the client portal. It is verified by 379 automated backend tests and by an automated walk through every route as every role.

---

## CHAPTER 2: INTRODUCTION

**Background.** A small or medium services company usually runs on a handful of disconnected tools: a spreadsheet for attendance, another for payroll, an accounting package for invoices, and a messaging application for approvals. Information is re-entered at each boundary, and the figures one tool reports rarely agree with another's.

**The name.** The name Riona is formed from two parts that together describe what the system does:

- **RIO — flow.** The things that move through the system: timesheets, approval requests, salary events, invoices, leads and tickets. Each has a state, and each changes state over time.
- **NA — structure, presence.** The fixed scaffolding the flow moves through: the organisation chart, roles and permissions, reference data masters, and the audit log.

This is more than a naming convention; it corresponds to a real division in the design. Every module can be classified as one or the other. Anything that seems to be both is usually two modules that have been merged by mistake. The division carries through to the database: the key flow records are stored append-only, while structural records are conventionally mutable, as described in Chapter 9.

**Why this project is needed.** The gap that matters most is between what an employee costs and what a client is billed. Both numbers come from the same event, an hour of work, yet they are almost always recorded twice, in two different systems. As a result, a company can run a client relationship at a loss for months without knowing it. Riona closes that gap by making the timesheet entry the single origin of both figures.

**How the application works.** A user signs in with an email and password, or with Google or Microsoft. They land in one of five role-specific views: Administrator, HR, Manager, Employee or Client.

- **Employees** log attendance, apply for leave, submit weekly timesheets, claim expenses and view their payslips.
- **Managers** approve their team's submissions and track project progress.
- **HR** runs payroll and manages the employee lifecycle.
- **Administrators** configure users, roles, approval workflows and reference data.
- **Clients** use a separate, restricted portal that shows only their own projects, invoices, tickets and shared documents. They can raise tickets and pay invoices online there.

Every request that needs an approval passes through one configurable approval engine rather than module-specific logic. This covers leave, expense claims, timesheets, attendance corrections, profile changes and invoice sign-off.

**Who will use it.** Employees, managers, HR staff and administrators of a services organisation, together with that organisation's clients through the restricted portal.

---

## CHAPTER 3: PROBLEM STATEMENT

**The existing problem.** In a typical services company:

1. Attendance, leave, payroll, project tracking and invoicing live in separate systems with no shared record, so the same hour of work is entered two or three times.
2. Because payroll cost and billed revenue live in different places, profitability per client and per project cannot be computed reliably. Decisions about which clients to keep are made on intuition.
3. Payroll is stored as editable rows, so a retroactive salary revision overwrites history. Nobody can then answer: "What was this employee actually paid in June, and why does it differ from the corrected figure?"
4. Approvals are handled over email and messaging, leaving no record of who approved what, when, or on what grounds.
5. Indian statutory payroll (Provident Fund, Employees' State Insurance, Professional Tax and Tax Deducted at Source) is computed by hand and is error-prone, particularly where arrears are involved.

**Why the application is needed.** The problem is not a shortage of features; existing tools have plenty. The problem is that the data is fragmented, so no single figure can be traced back to its source.

**How the proposed application solves it.** Riona enforces three structural rules:

- One timesheet entry feeds payroll cost, the invoice line and project margin at once, and each figure links back to the specific entries behind it.
- Salary is append-only. History is never overwritten, so any past state can be reconstructed.
- Every state change is written to an audit log that cannot be edited, in the same database transaction as the change itself, so no change can succeed without being recorded.

---

## CHAPTER 4: OBJECTIVES OF THE PROJECT

1. To develop a role-based web application serving five distinct user types from a single codebase, where each role sees only the functions it is permitted to use, and the server enforces the same rules.
2. To unify time accounting so that one timesheet entry produces payroll cost, the client invoice line and project margin at once, with every derived figure traceable to its source records.
3. To implement an event-sourced payroll ledger that preserves complete salary history and lets any payslip be regenerated as of any past date.
4. To compute Indian statutory payroll deductions (Provident Fund, Employees' State Insurance, Professional Tax and Tax Deducted at Source) and to generate payslips and Form 16.
5. To build a single configurable approval engine for all request types, rather than duplicating approval logic in each module.
6. To maintain an audit log that cannot be edited, written within the same transaction as the operation it records.
7. To provide a restricted client portal that structurally prevents internal data from reaching a client user: task assignees, hours, internal notes and unshared documents.
8. To develop the interface with React, Vite and TypeScript, and to implement the backend with Node.js and PostgreSQL in a layered service architecture.

---

## CHAPTER 5: SCOPE OF THE PROJECT

The application provides twenty-nine modules, grouped into six functional areas. They are reached through a top-bar navigation structure with no sidebar.

**Core HR**
- Employee directory and organisation chart
- Attendance and time tracking, with correction (regularisation) requests
- Leave management: types, accruals, balances and the holiday calendar
- Payroll with Indian statutory compliance and the salary event ledger
- Onboarding and offboarding checklists
- Performance review cycles and goals
- Recruitment pipeline
- Training and certification tracking with expiry alerts

**Project Work**
- Project management with Kanban board, list view and Gantt timeline
- Weekly timesheets with a billable flag per row, and a manager approval queue
- Shared calendar with layers that can be switched on and off

**Client Management**
- Client accounts with contacts, an activity log and a document vault
- Lead pipeline from first contact to won or lost
- Tracking of contract and service-level-agreement (SLA) expiry
- Support ticket desk with SLA countdown

**Finance**
- Invoice generation assembled directly from approved timesheet entries and billable expenses, with GST handling
- Expense claims with receipt upload
- Departmental budget tracking
- Profitability analysis by client, by project and by capacity

**Office Operations**
- Asset and inventory register with allocation history
- Meeting room booking
- Announcement board with acknowledgement tracking
- Knowledge base for standard operating procedures
- Visitor registration and check-in

**Administration and Self-Service**
- User management (invitations, deactivation) and a role permission matrix
- Visual approval workflow builder, including what happens when an approval's SLA passes
- Notification configuration
- Audit log that cannot be edited
- Reference data masters
- Employee self-service: payslips, leave, attendance, expenses, tasks, assets and profile
- Client portal, including online invoice payment

**Beneficiaries.** Employees gain self-service access to their own records. Managers gain approval queues and project visibility. HR gains an integrated payroll and lifecycle system. Management gains profitability data per client. Clients gain visibility into their own projects and invoices.

**Out of scope.** Direct bank integration for salary disbursement, statutory e-filing with government portals, and a native mobile application.

---

## CHAPTER 6: TOOLS AND TECHNOLOGIES USED

| Technology | Purpose |
|---|---|
| HTML5 | Document structure |
| CSS3 | Styling, responsive layout, light and dark themes |
| TypeScript | Language for frontend and backend, with static type safety across both and shared domain types |
| React 18 | User interface component library |
| Vite | Frontend build tool and development server (also proxies `/api` to the backend in development) |
| Hash-based router (built in) | Client-side routing across 128 routes with code splitting per hub; no routing library |
| Node.js 20 | Backend runtime |
| Fastify 5 | Backend HTTP framework: routing, request hooks and plugins |
| PostgreSQL 16 | Relational database, with triggers, row-level security and views |
| Kysely | Type-checked SQL query builder, with database types generated from the schema |
| Zod | Validation of every request body and query string |
| node-postgres (pg) | PostgreSQL driver |
| Nodemailer | Outgoing email (invitations, password resets, ticket replies) |
| Docker (Compose) | Runs PostgreSQL and the Mailpit development mail inbox |
| Vitest | Unit, contract, invariant and security tests (frontend and backend) |
| Playwright | Headless browser automation for route verification and end-to-end flows |
| axe-core | Automated accessibility auditing |
| Lighthouse | Performance measurement |
| ESLint | Static analysis, including React hooks rules |
| Git | Version control |
| VS Code | Code editor |
| Chrome / Firefox | Testing browsers |

---

## CHAPTER 7: SYSTEM REQUIREMENTS

**Hardware Requirements**
- Computer or laptop with a dual-core processor or better
- Minimum 8 GB RAM for development; 4 GB is sufficient for running the application
- About 3 GB of free disk space for the project, its dependencies and the database container
- Internet connection for installing packages

**Software Requirements**
- Operating system: Windows 10 or later, or any Linux distribution
- Node.js 20.12 or later, with npm
- Docker Desktop, which runs PostgreSQL 16 and the Mailpit mail inbox
- Code editor: Visual Studio Code or equivalent
- Web browser: Chrome, Firefox or any modern browser
- Git for version control

---

## CHAPTER 8: SYSTEM DESIGN

### 8.1 Application Workflow

```
User
  │
  ▼
Sign in (email + password, or Google / Microsoft)
  │
  ▼
Server checks credentials ──► session cookie issued (only its SHA-256 is stored)
  │
  ▼
Role resolved from the account
  │
  ├──────────┬──────────┬────────────┬──────────┐
  ▼          ▼          ▼            ▼          ▼
Admin       HR       Manager     Employee    Client
dashboard  dashboard  dashboard   My Space    Portal
  │          │          │            │          │
  └──────────┴─────┬────┴────────────┘          │
                   ▼                            ▼
            Hub page selected            Portal requests run as a
                   │                     restricted database role:
                   ▼                     the client's rows and
             Module screen               client-safe columns only
                   │
                   ▼
       Request to the API (HTTP + JSON)
                   │
                   ▼
   Session checked ──► permission and scope checked
                   │
         ┌──── Read or Write? ────┐
         │                        │
       Read                     Write
         │                        │
         ▼                        ▼
   Scoped query              CSRF header checked, input validated
   (own / team / all)             │
         │                        ▼
         ▼                   Transaction opens
   Figures computed               │
   at read time                   ▼
         │              Domain write + audit entry
         │              + notification queued (outbox)
         │                        │
         │                        ▼
         │              Commit; notifications and
         │              emails delivered afterwards
         │                        │
         └──────────┬─────────────┘
                    ▼
            Result displayed
```

### 8.2 Main Modules

The modules divide along the flow-and-structure axis described in Chapter 2. The flow modules (timesheets, approvals, payroll events, invoicing, leads, tickets) handle records that change state over time. The structural modules (directory and organisation chart, roles and permissions, reference masters, audit log) define the fixed framework those records move through. This distinction determines how each module's data is stored, as set out in Chapter 9.

**Authentication and Authorisation Module.**
- **Sign-in:** checks the email and password against a scrypt hash. Five failed attempts lock the account for fifteen minutes.
- **Session:** sign-in starts a server-side session held in a cookie; the database stores only a SHA-256 hash of its token, never the token itself.
- **Single sign-on:** Google and Microsoft sign-in uses OpenID Connect with PKCE. The server verifies the identity token's signature, issuer, audience, expiry and nonce, and signs in only an existing active account.
- **Request protection:** every state-changing request must carry a custom request header, which protects against cross-site request forgery.
- **Permissions:** checked at two levels on every request: whether the role may perform the action, and over what scope (own records, team, or all).
- **Accounts:** new users are invited by email and set their own password; deactivating a user ends their sessions immediately.

**Navigation Shell.**
- A fixed top bar carries six hub links, a command palette, a notification panel and an account menu.
- Navigation items are hidden entirely for roles that lack permission, rather than shown and disabled.
- Below 1024 pixels of viewport width, the hub links collapse into a full-screen menu overlay.

**Hub Pages and Dashboards.**
- There are six departure-lounge screens, one per functional area. Each shows summary metrics, module cards with live counts, and a short list of items waiting on the current user.
- The server computes the figures, the "needs your attention" lists and the analytics charts in a single request, over only what the signed-in person may see. Before this, the browser downloaded about thirty full collections to work them out.

**Approval Engine Module.**
- **One engine:** a single state machine serves every request type.
- **Workflows:** a workflow is an ordered sequence of steps, each naming an approver: a specific person, a role, the reporting manager, the department head or the account owner. Steps can branch on amount, duration and similar facts.
- **Versioning:** workflows are versioned, so a request in flight keeps the chain it was given even if the workflow changes later.
- **Builder:** the administrator configures workflows on a visual canvas.
- **SLAs:** each approver step can carry an SLA. When it passes, a background job either reminds the approver once, or, if the workflow explicitly says so, approves the step automatically and records the reason.

**Payroll and Salary Ledger Module.**
- Maintains the append-only salary event log, and computes payslips by replaying events up to a chosen date against the statutory rules in force at that time.
- Payroll runs progress through four stages: review inputs, calculate, approve, disburse. When a run closes, its payslips are frozen.
- Inputs for a month lock on the 25th.
- Generates Form 16.

**Time and Billing Module.**
- Captures weekly timesheets with a billable flag per row, routes them for manager approval, and offers approved billable hours to the invoice builder.
- The server builds each invoice from the chosen entry identifiers. The screen never supplies amounts, and each line keeps links to the entries it bills.
- Large invoices go through a sign-off workflow. On issue, the totals are frozen.
- Payments are recorded against the frozen total. Revisions keep the invoice as first issued.

**Profitability Module.**
- Computes revenue, labour cost, expenses and margin per client, per project and per person, entirely at read time.
- Labour cost uses a cost rate derived from each employee's salary history as of the date of the work.
- Every figure drills down to the timesheet entries behind it.

**Audit Module.**
- Records every state change with timestamp, actor, action, entity, before-and-after field values, IP address and request identifier.
- The database itself refuses any update or deletion of audit rows, and no deletion facility exists anywhere in the interface.

**File Storage Module.**
- Accepts uploads (documents, receipts) against an allow-list of file types and a size limit.
- Records each file's SHA-256 hash and serves downloads only through five-minute signed links, after checking that the requester may see the record the file belongs to.

**Client Portal Module.**
- A separate application shell with its own API (`/portal/*`).
- Every portal read runs in a read-only database transaction under a dedicated PostgreSQL role. That role is granted only client-safe columns, and row-level security limits every table to the signed-in client's rows.
- As a result, even a mistaken query cannot return another client's data or internal fields such as hours, assignees and internal notes.
- Client accounts are refused on every staff endpoint, and staff accounts on the portal's.

### 8.3 User Interface Design

Screenshots of the main pages are reproduced in Chapter 12.

The interface follows a consistent set of layout rules across all 128 routes:

- Top-bar navigation only, with no sidebar. Breadcrumbs appear below the bar on every page except the dashboard, giving the path back up.
- Each screen performs one task. Detail views open as their own routes with their own URLs, rather than as expanding panels or overlays.
- Tables use hairline row separators, generous row height and no vertical grid lines. Row actions appear on hover.
- Colour is used only to indicate status. Visual hierarchy comes from spacing and type scale.
- Below 768 pixels, tables convert to stacked cards showing three fields and a navigation chevron.

---

## CHAPTER 9: DATABASE DESIGN

### 9.1 Database Name

The database is named `riona`. The automated tests use a separate database, `riona_test`, which is created and reset automatically.

The schema is built by 15 ordered migration files and has 76 tables, one view (`entry_costs`, which derives each timesheet entry's cost rate from salary history) and 15 triggers that enforce integrity rules. Records use readable text identifiers (for example `E-0112` for an employee and `INV-2026-0158` for an invoice), which keeps logs, audit entries and links easy to read. All money is stored as whole paise in 64-bit integers, so no amount suffers floating-point rounding.

### 9.2 Table Structure

The schema divides into two categories, following the flow-and-structure distinction the project's name describes. This division is the central design decision rather than an implementation detail.

**Append-only tables (flow).** Rows are inserted and never updated or deleted, and current state is derived by replaying the sequence. Database triggers enforce this on ten tables: `salary_events`, `payslips`, `audit_log`, `approval_steps`, `workflow_versions`, `invoice_revisions`, `payments`, `expense_revisions`, `stock_movements` and `lead_activity`.

`salary_events`

| Field Name | Data Type | Description |
|---|---|---|
| id | TEXT | Unique event identifier |
| seq | BIGINT | Insertion order, for a stable replay sequence |
| employee_id | TEXT | Reference to employee |
| type | TEXT | Hired, Revised, Promotion, Bonus, Deduction or Correction |
| effective | DATE | Month from which the event applies |
| recorded | DATE | When the event was entered (set by the server) |
| ctc_paise | BIGINT | New annual cost-to-company (for Hired, Revised, Promotion) |
| amount_paise | BIGINT | One-off amount (for Bonus, Deduction, Correction) |
| applies_to | TEXT[] | Months a correction applies to |
| component | TEXT | Salary component affected |
| actor_id | TEXT | Who recorded it, taken from the session, never from the request |
| note | TEXT | Reason, mandatory for corrections |
| title | TEXT | Designation at the time |

`audit_log`

| Field Name | Data Type | Description |
|---|---|---|
| id | TEXT | Unique entry identifier |
| seq | BIGINT | Insertion order |
| at | TIMESTAMPTZ | When the change occurred |
| actor_id | TEXT | Employee who made the change (null for the system) |
| actor | TEXT | Their name at the time |
| action | TEXT | Created, Updated, Approved, Rejected and so on |
| entity | TEXT | Type of record affected |
| entity_id | TEXT | Identifier of the record affected |
| changes | JSONB | List of field, before value and after value |
| ip | TEXT | Originating address |
| request_id | TEXT | The API request that made the change |

`payslips` hold each closed payroll run's payslips exactly as issued (`run_id`, `employee_id`, `month`, `slip` JSONB, `net_paise`, `frozen_at`).

**Mutable tables (structure).** These are conventional create-read-update-delete records.

`employees` (main fields)

| Field Name | Data Type | Description |
|---|---|---|
| id | TEXT | Employee identifier (e.g. E-0112) |
| name | TEXT | Full name |
| email | TEXT | Official email address |
| phone | TEXT | Contact number |
| title | TEXT | Designation |
| dept | TEXT | Department |
| manager_id | TEXT | Reporting manager (references employees) |
| location, state | TEXT | Work location and state (for Professional Tax) |
| type | TEXT | Full-time, contract, intern |
| status | TEXT | Active, On leave, Probation, Inactive |
| joined | DATE | Start date |
| billable | BOOLEAN | Whether their hours may be billed |
| bill_rate_paise | BIGINT | Hourly rate charged to clients |
| pan, uan, bank_account | TEXT | Statutory and bank details (shown only to HR, Admin or the person) |

`timesheet_entries`, the central table of the system

| Field Name | Data Type | Description |
|---|---|---|
| id | TEXT | Unique entry identifier |
| employee_id | TEXT | Who logged the hours |
| project_id | TEXT | Project worked on |
| client_id | TEXT | Client the project belongs to |
| task_id | TEXT | Task, if any |
| date | DATE | Date of work |
| hours | NUMERIC | Hours logged |
| billable | BOOLEAN | Whether the entry may reach an invoice |
| note | TEXT | Work performed |
| status | TEXT | Draft, Submitted, Approved, Rejected |

The entry deliberately stores no rates:
- **Cost rate:** derived at read time by the `entry_costs` view from the employee's salary history as of the entry's month.
- **Bill rate:** comes from the employee when an invoice is built, and is then fixed on the invoice line.

**Billing tables.**
- `invoices` and `invoice_lines` hold the invoices, with totals frozen in `issued_totals` when an invoice is issued.
- `invoice_line_entries` links each line to the timesheet entries it bills, so every derivation stays traceable. A unique index on live links means one entry can be billed only once.

**Further tables** include:
- **Work and people:** `clients`, `projects`, `tasks`, `leave_requests`, `attendance`, `regularisations`, `profile_changes`, `timesheet_weeks`.
- **Finance:** `expenses`, `budgets`, `payroll_runs`, `salary_structures`, `statutory_filings`.
- **Approvals:** `approvals`, `workflows`.
- **Clients:** `leads`, `contracts`, `tickets`, `ticket_messages`, `documents`, `document_versions`, `files`.
- **Workplace:** `assets`, `asset_allocations`, `inventory_items`, `rooms`, `bookings`, `announcements`, `kb_articles`, `visitors`.
- **Talent:** `jobs`, `candidates`, `onboarding_cases`, `reviews`, `goals`, `certifications`.
- **Accounts and system:** `users`, `sessions`, `roles`, `password_resets`, `notifications`, `outbox`, `payment_intents`, `notification_rules`, `master_lists`, `master_rows`, `system_jobs`.

### 9.3 Database Operations

**Insert.** New records are created through the service layer, never directly from a route handler. Every write runs inside one transaction helper, which also writes the audit entry and queues any notification or email in an "outbox" table. A successful write therefore cannot exist without its audit record. Messages are delivered only after the transaction commits.

**Select.** All reads pass through services that apply the caller's permission scope: their own records, their team's, or everyone's. Derived figures (margins, balances, totals, utilisation) are computed at read time rather than stored, which keeps them consistent with the records they summarise. Client portal reads run under the restricted portal database role with row-level security.

**Update.** Permitted only on mutable tables; append-only tables reject updates in the database itself. The previous and new field values are captured in the audit entry.

**Delete.** Deliberately restricted. Append-only tables permit no deletion. On mutable tables, records are generally marked inactive rather than removed, which preserves referential integrity for historical reporting.

**Rules enforced by the database itself:**
- Rows in the ten append-only tables can't be updated or deleted.
- Only an approved, billable timesheet entry belonging to the invoice's client can be placed on an invoice, and only once.
- Once billed, an entry's hours, project, billable flag and status can no longer change, and it can't be deleted.
- An invoice's frozen total can never fall below what has been paid against it, whether the invoice is changed or a payment is recorded.
- No salary event can change a closed payroll run.
- An asset has at most one open allocation, and stock can never go negative.
- A client user's database role can read only that client's rows and only client-safe columns.

**Rules enforced by the service layer:**
- Inputs for a month lock on the 25th.
- Only issued invoices with an outstanding balance can be revised, and a revision needs a stated reason.
- The actor and recorded date on a salary event come from the server session, never from the request.

---

## CHAPTER 10: IMPLEMENTATION

**Development approach.** The project was built in two stages.

**Stage 1 — the frontend (seven phases).** The data layer and its integrity rules came first, running against an in-memory demo dataset. Next came the screens carrying the project's distinguishing features, from which a shared component library was extracted. The remaining modules were then built on that library, and the public site and client portal came last. Each phase ended with a verification gate that had to pass before the next began.

**Stage 2 — the backend (ten waves).** Each wave was finished, tested and verified in the browser before the next started:

| Wave | Delivered |
|---|---|
| 0 | Server skeleton: configuration, error format, health check, migrations, Docker database |
| 1–2 | Sign-in, sessions and CSRF protection; the transaction-and-audit helper; notifications and email through an outbox |
| 3 | People: employees, attendance, leave, corrections, profile changes; clients, projects and tasks |
| 4 | The approval engine with versioned workflows; timesheets |
| 5 | Payroll: the salary ledger, statutory rules, frozen payslips, Form 16, the payroll lock |
| 6 | Billing: invoices built from entry identifiers, GST, revisions, payments, expenses, budgets, profitability |
| 7 | The client portal with row-level security, ticketing and online payment |
| 8 | The remaining modules, file uploads with signed downloads, invitations and password reset |
| 9 | Dashboards computed on the server, Google and Microsoft sign-in, approval SLA timeouts, the every-endpoint contract test; the in-memory demo data removed |

**Frontend architecture.** No screen accesses data directly:

```
src/
  data/
    repositories/   contract.ts  the 137 data functions and their signatures
                    http/        the HTTP client and the endpoint table (139 routes)
    selectors/      derived figures computed from repository output
    types/          shared domain type definitions
  components/       shared component library
  screens/          route components, one per page
  portal/, public/  client portal and public site
  lib/              query cache, formatting, dates
```

Every repository function is asynchronous and returns a Promise. This was true even while the data still came from an in-memory demo dataset, so loading and error handling were genuine code paths in every screen from the start. When the backend was ready, the demo dataset was removed, and only the repositories directory changed; the screens did not. Automated tests check that every function's arguments survive the round trip through an HTTP request, and that no file other than the HTTP client calls the network directly.

Example repository signatures:

```
getEmployees(filter?: EmployeeFilter): Promise<Paginated<Employee>>
getTimesheetEntries(filter?: TimesheetFilter): Promise<TimesheetEntry[]>
createInvoice(input: NewInvoiceInput): Promise<Invoice>
getDashboardFacts(role?: Role): Promise<DashboardFacts>
```

**Backend architecture.**

```
backend/
  db/migrations/      15 ordered SQL migrations (tables, triggers, row-level security)
  db/views/           the entry_costs view
  db/seed/            the demo organisation, loaded with "npm run db:seed"
  src/http/plugins/   session, CSRF, portal scope, error handling
  src/http/routes/    one file per area; routes validate input and call services
  src/modules/        services per area (people, work, finance, clients,
                      workplace, admin, portal, dashboard)
  src/engines/        approvals, payroll, audit, notifications
  src/auth/           permission matrix and scopes, password hashing, single sign-on
  src/storage/        file storage and signed download links
  src/jobs/           background jobs (notification delivery, overdue invoices,
                      approval SLAs)
packages/shared/      domain types and the error contract shared by frontend and backend
```

**Routing.** There are 128 routes, using a small built-in router based on the URL hash. Each hub is lazy-loaded, so a user downloads only the code for the sections they visit.

**Key features and their implementation**

*The salary event ledger.* The compensation view presents the employee's salary as a sequence of events. Selecting a date recomputes the payslip by replaying all events effective on or before that date, with statutory deductions recalculated under the rules of that financial year. A toggle switches between the corrected figure and the figure actually paid at the time, and shows the difference in net pay. The second view replays only the events recorded before the payment date, ignoring corrections entered afterwards. The server computes the payslips, and those of a closed run are frozen.

*The invoice builder.* After a client is selected, the screen shows approved, billable timesheet entries not yet on any invoice, together with approved billable expense claims.
- Selecting items assembles invoice lines with a live total. GST is split into CGST and SGST for a client in the same state, or charged as IGST for one in another state.
- A side panel shows the same hours as billed revenue, payroll cost and the resulting margin.
- The server rebuilds the lines from the selected entry identifiers, so the screen can't misstate an amount.
- Each line keeps the identifiers of its source entries, and the database refuses to bill any entry twice.

*The profitability view.* This is a table of clients sorted by margin in ascending order, so loss-making relationships appear first. Rows expand twice: from client to projects, and from project to the people who logged hours. Every revenue and cost figure leads to the timesheet entries behind it.

*The approval engine.* A request is created with a reference to its workflow version. The engine resolves each step's approver, records each decision as an appended step record, and advances until the request is approved or rejected. Then the outcome is applied in the same transaction: the leave is granted, or the invoice issued, and so on.

*Role-based access.* Navigation items and actions are filtered by role when the screen renders, and the server enforces the same permission matrix and record scope on every request.

---

## CHAPTER 11: TESTING

Testing was done at five levels:
- backend tests running against a real PostgreSQL database;
- frontend unit tests;
- automated verification of every route, as every role, at two screen widths;
- scripted browser flows for each backend wave;
- automated accessibility auditing.

**Test summary**

| Test Category | Scope | Result |
|---|---|---|
| Type checking | Frontend, backend and shared types | Pass |
| Backend tests (on PostgreSQL) | 17 files: API contract, data invariants, security | 379 of 379 pass |
| Endpoint contract | Every one of the 139 endpoints answers correctly | 140 of 140 pass |
| Frontend unit tests | Contract round-trip and data boundary | 66 of 66 pass |
| Route verification | 121 staff routes × 4 roles × 2 widths, plus 7 portal routes × client × 2 widths = 982 visits | Pass; zero console errors; 40 refusals of records outside a role's scope, all correct |
| Browser flows (backend waves) | Scripted end-to-end checks per wave (e.g. 19, 17, 19 and 20 checks for waves 6–9) | All pass |
| Product interaction flows (frontend phase) | 40 assertions across 5 flows | 40 of 40 pass |
| Self-service flows (frontend phase) | 23 scripted click-throughs | 23 of 23 pass |
| Accessibility (axe-core) | 12 representative routes at 2 widths | Zero serious or critical issues |
| Static analysis (ESLint) | 91 frontend source files | Clean |

**Feature test results**

| Test No. | Feature Tested | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| 1 | User login | Correct dashboard for the role; wrong password refused; lockout after five failures | As expected | Pass |
| 2 | Role-based access | Unauthorised hubs hidden; the API refuses them (403/404) | Hidden in the UI and refused by the server | Pass |
| 3 | Timesheet entry and submission | Week locked pending approval | Locked and queued to the manager | Pass |
| 4 | Manager approval | Status updated, requester notified, decision audited | Status, notification and audit entry correct | Pass |
| 5 | Invoice assembly from timesheets | Server builds lines from entry identifiers; quantities are the hours | Matched independent calculation | Pass |
| 6 | Entry billed only once | Second attempt refused by the API (409) and by the database | Both refused | Pass |
| 7 | Totals frozen at issue | Later changes don't alter an issued invoice's totals | Unchanged | Pass |
| 8 | Payslip regeneration by date | Payslip recomputed as of the chosen date | Correct for Oct 2024, May 2025, Sep 2026; server matches screen | Pass |
| 9 | Corrected versus paid payslip | Both figures shown with the difference | Differences correct in all three cases | Pass |
| 10 | Profitability reconciliation | Margin = revenue − cost − expenses, server equal to screen | Identity holds for every client and project | Pass |
| 11 | Profitability drill-through | Entries behind a figure sum to that figure | Sums matched | Pass |
| 12 | Client portal isolation | No internal data even with a deliberately broken query | Internal columns denied; other clients' rows invisible | Pass |
| 13 | Online invoice payment | Balance settled once; webhook signature and amount checked | Paid once; forged or wrong-amount webhooks refused | Pass |
| 14 | Single sign-on | Valid token signs in; forged, expired or misdirected tokens refused | 8 attack cases all refused | Pass |
| 15 | Approval SLA | Reminder once after the SLA; auto-approval only when configured | As expected | Pass |
| 16 | File upload and download | Same bytes back through a signed link; expired or altered links refused | As expected | Pass |
| 17 | Invitation and password reset | Invite email → set password → signed in; other sessions ended | As expected | Pass |
| 18 | Invoice revision rules | Reason required; total can't fall below the amount paid; first issued state kept | All enforced | Pass |
| 19 | Responsive layout at 390 px | No horizontal scrolling on any route | None across every role's visits | Pass |

**Reconciliation test.** The most significant automated test asserts, on PostgreSQL, for every client and every project:

```
revenue      = sum of that client's invoice line amounts
labour cost  = sum of (hours × cost rate) across its timesheet entries
margin       = revenue − labour cost − expenses
```

It also asserts that the server's figures equal those computed by the frontend's own calculation code over the same records. Because derived figures are computed rather than stored, any change that let them diverge would make the test fail.

**Defects found and fixed during testing**

*Frontend phase:*

1. Form 16 included an undisbursed November payroll run in its totals.
2. Navigating between two setup links kept the first link's error state; fixed by keying the wizard component to the token.
3. Task completion checkboxes didn't respond until the server replied; they now update immediately (optimistically).
4. A React hook sat after an early return, breaking the rules of hooks; this was caught once the lint rules were enforced without exceptions.
5. Opening the invoice builder with a pre-selected client left all items unselected; found while removing an unnecessary effect.
6. Eighteen colour-contrast failures; each colour was darkened to reach at least 4.6:1 against its background.

*Backend phase:*

7. Approvals routed to "Finance" crashed the server, because a role name was compared against the fixed list of login roles.
8. The rule "payments can't exceed the invoice total" was checked only when the invoice changed, not when a payment was recorded; a second database trigger was added.
9. An approver for a step outside their usual scope (Finance) couldn't open the claim they had been asked to approve.
10. Invitations could create accounts with no employee record, which then couldn't use the app; HR now adds the person first.
11. "Forgot password" emailed a link to a page that didn't exist; the reset page and its endpoints were added.
12. "Resend invite" showed a success message without sending anything; it now sends a new link.
13. After the demo data was removed, the HR, Manager and Employee dashboards requested admin-only lists and failed; they now request only what the role may see.
14. The portal's "Sign out" only changed page without ending the session.

**Performance.**
- Measured with Lighthouse at 390 pixels, on a throttled connection with a 4× CPU slowdown. Converting two background images from PNG to WebP cut the transferred payload from 2,997 KB to 267 KB, and time to interactive from 14.8 seconds to 3.2 seconds, with no visible difference.
- Moving the dashboard figures to the server cut a dashboard load from about 35 API requests to 8.

---

## CHAPTER 12: RESULTS AND SCREENSHOTS

The screenshots below were captured from the running application with the Kestrel Digital demonstration organisation, whose data is dated 6 November 2026. Each was taken at 1440 × 900 pixels, except the mobile view at 390 pixels. Where a page is longer than one screen, it is shown in several consecutive parts.

<!-- SCREENSHOTS -->

---

## CHAPTER 13: LIMITATIONS

1. **Role edits are recorded but not yet enforced.** Admin › Roles saves and audits changes to the permission matrix, but the server still enforces the permission matrix defined in code.
2. **Notification rules are recorded but not yet applied.** Admin › Notification rules saves which channels each event uses, but delivery does not consult them yet.
3. **Online payment uses a simulated gateway in development.** The server side of a real gateway is in place: payment intents and a signed, idempotent webhook. No payment provider is connected yet, so online payment is switched off in production until one is.
4. **Single sign-on needs provider credentials.** Google and Microsoft sign-in work once the organisation registers the application with them; until then the buttons say it isn't set up.
5. **Tax figures are approximations.** Tax Deducted at Source is calculated from published slab rates on the server, but has not been verified against a production payroll engine. Estimated figures are marked as such in the interface.
6. **Files are stored on the server's disk.** This suits a single server; several servers would need shared object storage.
7. **No multi-factor authentication** yet.
8. **No bank integration.** Payroll disbursement produces a bank file for manual upload; direct transfer is not implemented.
9. **No statutory e-filing.** The system computes liabilities and generates returns, but does not submit them to government portals.
10. **No native mobile application.** The interface is responsive and usable on a phone, but cannot be installed as an app.
11. **Minor accessibility items outstanding** (from the frontend audit). The setup wizard lacks a level-one heading, some landing page content sits outside page landmarks, and one table has an unlabelled actions column. All are rated moderate or minor.

---

## CHAPTER 14: FUTURE SCOPE

1. **Make role permissions data-driven,** so that edits in Admin › Roles change what the server allows. This should be a deliberate migration, so existing access doesn't change unexpectedly.
2. **Apply notification rules in delivery,** including the daily digest.
3. **Connect a real payment gateway** to the existing webhook.
4. **Add multi-factor authentication,** and move file storage to object storage for multi-server deployment.
5. **Add bank integration** for direct salary disbursement and automatic payment reconciliation.
6. **Implement statutory e-filing** with the Employees' Provident Fund Organisation, the Employees' State Insurance Corporation and the income tax portal.
7. **Add capacity forecasting.** The system already holds utilisation history, so forecasting team-level capacity and hiring needs is a natural extension. This is deliberately framed at team level. Scoring individuals on attrition risk was considered and rejected: such scores tend to become self-fulfilling and are hard to justify ethically.
8. **Build a native mobile application** for attendance marking, leave applications and approval actions.
9. **Add biometric attendance integration** with physical access devices.
10. **Add multi-currency and multi-entity support** for organisations operating across jurisdictions.
11. **Introduce automated anomaly detection** on timesheet and expense submissions, flagging unusual patterns for review rather than blocking them.

---

## CHAPTER 15: CONCLUSION

**What was developed.** Riona is a web-based office management system with twenty-nine modules across human resources, project execution, client management, finance and office administration, serving five user roles.
- **Frontend:** 128 routes built with React 18, Vite and TypeScript.
- **Backend:** built with Node.js, Fastify and PostgreSQL 16. It serves all 137 data functions the interface uses, through 139 endpoints.
- **Verification:**
  - 379 backend tests on a real database;
  - a test that calls every endpoint;
  - an automated walk through 982 route visits, as every role at two widths, with zero console errors.

**What was learned.** The most valuable lesson concerned architectural boundaries rather than any particular technology. Two rules seemed unnecessary while the data came instantly from memory: no screen may access data directly, and every data function must be asynchronous from the start. Yet those two rules are what made the backend possible without rewriting the screens. When the server was ready, only one directory changed, and the in-memory demo data could simply be deleted.

A second lesson concerned derived data. Storing a computed margin would have been simpler and faster, but any stored derivation eventually drifts from its source. Instead, figures are computed at read time, and a test asserts on the real database, for every client and project, that revenue minus cost minus expenses equals margin. So the system cannot silently produce inconsistent figures. Invoices are the deliberate exception: their totals are frozen when issued, because an issued invoice must not change.

A third lesson concerned the value of append-only storage. Treating salary as a sequence of events rather than editable rows first seemed like unnecessary complexity for a student project. In practice, retroactive correction, arrears, historical payslip regeneration and the audit trail all come from the same mechanism. Enforcing append-only in the database, rather than trusting the application code, means a bug elsewhere cannot rewrite history.

A fourth lesson was to enforce safety rules where they cannot be bypassed. The client portal is protected by the database itself, not only by careful queries. The rule that an hour is billed once lives in a database constraint, not just in the invoice screen. Each of these was checked by tests that deliberately tried to break it.

The flow-and-structure division that gives the project its name proved to be a genuinely useful design tool rather than a naming exercise. Classifying each module and table as one or the other made several decisions straightforward that would otherwise have needed debate, particularly which records must never be overwritten.

**Whether the objectives were achieved.** All eight objectives are met.
- **Interface and server:** the interface is complete, and every function it relies on is served by a backend that enforces permissions, validates input and audits every change.
- **Payroll:** the payroll ledger, statutory deductions, approval engine and audit log all run on the server.
- **Client portal:** the portal's isolation is enforced by the database.

The remaining limitations are listed in Chapter 13: making role edits enforceable, connecting a real payment gateway, and the out-of-scope integrations.

**Real-world usefulness.** Riona answers a question comparable systems do not: whether a given client relationship is profitable, and which engagements make it so. In a services business, labour is the main cost and billable time the main revenue, so that one answer can decide which clients to keep. Making it computable, traceable and impossible to fudge is the system's practical value.

---

## CHAPTER 16: REFERENCES

1. React Documentation — https://react.dev/
2. Vite Documentation — https://vite.dev/
3. TypeScript Handbook — https://www.typescriptlang.org/docs/
4. Node.js Documentation — https://nodejs.org/docs/
5. Fastify Documentation — https://fastify.dev/docs/
6. PostgreSQL Documentation — https://www.postgresql.org/docs/
7. PostgreSQL Row Security Policies — https://www.postgresql.org/docs/current/ddl-rowsecurity.html
8. Kysely Documentation — https://kysely.dev/
9. OpenID Connect Core 1.0 — https://openid.net/specs/openid-connect-core-1_0.html
10. RFC 7636: Proof Key for Code Exchange (PKCE) — https://www.rfc-editor.org/rfc/rfc7636
11. OWASP Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
12. MDN Web Docs — https://developer.mozilla.org/
13. Web Content Accessibility Guidelines (WCAG) 2.1 — https://www.w3.org/TR/WCAG21/
14. Employees' Provident Fund Organisation — https://www.epfindia.gov.in/
15. Employees' State Insurance Corporation — https://www.esic.gov.in/
16. Income Tax Department, Government of India — https://www.incometax.gov.in/
17. Goods and Services Tax Council — https://gstcouncil.gov.in/
18. Martin Fowler, "Event Sourcing" — https://martinfowler.com/eaaDev/EventSourcing.html
19. Deque axe-core Documentation — https://github.com/dequelabs/axe-core

---

## APPENDIX

A. The API contract: the 137 data functions with their signatures (`frontend/app/src/data/repositories/contract.ts`), the endpoint table of 139 routes (`frontend/app/src/data/repositories/http/endpoints.ts`), and the original contract notes (`frontend/app/HANDOFF.md`).

B. Reconciliation test source (`backend/test/invariants/reconciliation.test.ts`).

C. The database migrations (`backend/db/migrations/`), including the integrity triggers and the client portal's row-level security.

D. Complete route list, all 128 routes (`frontend/app/scripts/routes.txt`).

E. Additional screenshots: the complete set of screenshots is reproduced in Chapter 12; the original image files are in `docs/screenshots/`.
