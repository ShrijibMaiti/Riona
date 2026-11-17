# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary customers are **Indian IT services firms**: IT services companies, agencies and consultancies of roughly 20–200 staff that bill their clients for time. The demo organisation, Kestrel Digital, is the reference customer.

Five roles use the product, each with its own view:

- **Admin** (owner or operations lead): wants to know which clients and projects actually make money; configures users, roles, approval workflows and reference data.
- **HR**: runs monthly payroll with Indian statutory compliance and manages the employee lifecycle (hiring, onboarding, leave, performance, exits).
- **Manager**: approves the team's timesheets, leave and expenses; runs projects.
- **Employee**: does the daily self-service: attendance, weekly timesheets, leave, expense claims, payslips, tasks and assets ("My Space").
- **Client**: a contact at a customer company who uses a separate, restricted portal to follow their projects, pay invoices, raise tickets and fetch shared documents.

While Riona is an academic project, faculty evaluators are a secondary audience.

## Product Purpose

Riona is one system for a services firm's people, projects, clients, finance and office operations, replacing the spreadsheets, accounting package and chat threads that usually hold these apart.

It exists because the cost of an hour of work and the amount billed for it are normally recorded twice, in different tools, so a firm can lose money on a client for months without knowing. Success means the firm can see which clients and projects are profitable, trace every figure back to the hours behind it, and never lose payroll history.

## Positioning

- **One timesheet entry is the single source** of three figures: the employee's payroll cost, the client's invoice line and the project's margin. Every derived figure links back to the entries behind it, and those figures are computed when read rather than stored.
- **Payroll is event-sourced.** Salary is an append-only ledger, so any payslip can be regenerated as it stood on any past date, and corrections and arrears are replays rather than edits.
- **Approvals and records are uniform.** One approval engine serves every request type, and every change is audited in the same transaction as the change itself.
- **Client isolation is enforced by the database.** The client portal is restricted by the database itself (row-level security and column grants), not only by the interface.

## Operating Context

- **Market:** India.
  - Currency: rupees, with lakh grouping.
  - Time zone: Asia/Kolkata.
  - Statutory payroll: PF, ESI, Professional Tax by state slab, and TDS under both regimes, with Form 16.
  - GST: CGST + SGST within the firm's state, IGST across states.
- **Rhythms:**
  - Weekly timesheets, with a billable flag per row and approval by the manager.
  - Monthly payroll runs (review inputs → calculate → approve → disburse); a month's inputs lock on the 25th.
  - Invoices are assembled from approved, unbilled hours and billable expenses.
  - One approvals queue covers every request type, with optional SLAs per approver step.
- **Hubs:** six, named People, Work, Clients, Finance, Workplace and Admin, plus My Space and the separate client portal.
- **Demo data:** the Kestrel Digital organisation (60 employees, 8 clients, 15 projects), dated 6 November 2026.

## Capabilities and Constraints

- **Status: academic project now, product later.** It is evaluated as a B.Tech project first, with a plan to launch it to real firms afterwards.
- **Scope:** twenty-nine modules across five roles; 128 routes in the web app.
- **Architecture:**
  - The frontend is a React 18, Vite and TypeScript single-page app with a hash-based router, and lives in `frontend/app`.
  - The backend is Node.js, Fastify and PostgreSQL 16, in `backend`.
  - All data flows through one repository layer: 137 functions over 139 HTTP endpoints, as declared in `src/data/repositories/contract.ts` and `http/endpoints.ts`.
- **Access rules:** each role sees only what it may use; navigation the role can't use is hidden, not disabled, and the server enforces the same rules.
- **Terminology:** hubs, My Space, approvals queue, salary events (Hired, Revised, Promotion, Bonus, Deduction, Correction), regularisation (attendance correction), "as first issued" (invoices), live versus frozen payslips.
- **Roadmap (not built):**
  - field-level encryption of salary and bank data;
  - CSV import and migration;
  - SAML/SCIM;
  - statutory e-filing;
  - direct bank disbursement;
  - multi-factor authentication;
  - a connected payment gateway (only a simulated one exists);
  - enforcement of Admin › Roles edits;
  - notification rules that actually drive delivery.

## Brand Commitments

- **Name and meaning:** the product is named **Riona**. *RIO* means flow (timesheets, approvals, salary events, invoices, leads and tickets moving through states) and *NA* means structure and presence (the organisation chart, roles, masters, the audit log). Treat this flow-and-structure split as a product idea, not decoration.

## Evidence on Hand

- **Demo organisation:** Kestrel Digital, with realistic data, in `backend/db/seed/demo`.
- **App screenshots:** used on the public site, in `public/previews/`.
- **Project report:** `docs/Riona_Project_Report.pdf`, with its source in `docs/Riona_Project_Report.md`.
- **Verification evidence:**
  - 379 backend tests;
  - a route gate covering every route for every role at 1440 and 390 px;
  - accessibility audits with axe-core.
- **Absences:**
  - no real customers, testimonials, case studies, press, pricing or usage figures exist;
  - the customer logos on the public site (Northwind Logistics, Aster Health, Bluefin and the rest) are the fictional demo clients. They are illustrative only: never present them, or any invented proof, as real customers.

## Product Principles

1. **One source per fact.** A figure is computed from the records behind it and leads back to them; nothing derived is stored where it could drift (issued invoices are frozen on purpose).
2. **History is appended, not overwritten.** Corrections are new events, so any past state can be reconstructed.
3. **Every change is accountable.** It is attributed, audited in the same transaction, and visible to the people it concerns.
4. **Each role sees only what it may use.** Access is hidden rather than disabled, and the server, not the screen, is the authority.
5. **Claims match the product.** What is built is presented as built. Planned features (see the roadmap) are labelled as coming, and demo data is never posed as real customers.

## Accessibility & Inclusion

- **Inferred target, not yet confirmed: WCAG 2.1 AA.** The evidence:
  - existing axe-core audits with zero serious or critical issues;
  - text-colour contrast raised to at least 4.6:1;
  - every route is checked at 390 px without horizontal scroll.
