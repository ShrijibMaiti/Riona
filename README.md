# Riona

Office management for a services company in India: HR, projects, clients, finance and office operations.

```
riona/
├── frontend/app/      React 18 + Vite + TypeScript (complete). The design bundle sits beside it in frontend/.
├── backend/           Fastify + Kysely + PostgreSQL (being built in waves)
└── packages/shared/   types and the error contract used by both
```

## First-time setup (Windows cmd)

Needs Node 20.12+ and Docker Desktop (running).

```bat
cd /d D:\riona
copy .env.example .env
copy backend\.env.example backend\.env
copy frontend\app\.env.example frontend\app\.env.local
npm install
npm run db:up
npm run db:seed -w backend
```

`db:seed` resets the development database, applies the migrations and loads the demo data. Run it again any
time to start over (`db:migrate` applies new migrations without touching data).

### Signing in

Every demo account uses the password `riona-demo-2026`:

| Role | Email |
|---|---|
| Admin | dipak.sharma@kestrel.digital |
| HR | meera.iyer@kestrel.digital |
| Manager | vikram.menon@kestrel.digital |
| Employee | aarav.shah@kestrel.digital |
| Client (portal, Lumen Energy) | meghna@lumen.in |

Every client's primary contact has a portal account (e.g. rajiv@northwind.in for Northwind). A client account lands
in `#/portal` and can use nothing else; staff accounts can't use the portal.

The role comes from the account. "Continue with Google / Microsoft" works once that provider's client id and secret
are set in `backend\.env` (see `.env.example`); until then it says single sign-on isn't set up. When the session ends (sign-out, expiry, deactivation), any request answers 401 and the app
returns to `#/login`. In development the server clock is pinned to the demo data's date (`CLOCK_FIXED_NOW` in
`backend\.env`). Password-reset and other emails land in Mailpit (http://localhost:8025).

In `backend\.env` replace `SESSION_SECRET` with a random value:

```bat
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The frontend always talks to the API (browser → Vite proxy → backend). The in-memory fixture it started with, and
its seed, were removed in Wave 9; the demo data now lives in `backend/db/seed/demo` and reaches the browser only
through the API. An old `VITE_DATA_SOURCE` line in `frontend\app\.env.local` is ignored.

Postgres from docker-compose listens on **5433** on your machine, so it doesn't clash with a locally installed
Postgres on 5432.

## Every day

One terminal for everything:

```bat
npm run dev
```

or two, if you want the logs apart: `npm run dev:backend`, `npm run dev:frontend`.

| What | Where |
|---|---|
| App | http://localhost:5173 |
| API | http://localhost:3000/api/v1 (health: `/api/v1/health`) |
| Email inbox (Mailpit) | http://localhost:8025 |
| Postgres | localhost:5433, user/password/db `riona` |

The frontend proxies `/api` to the backend, which serves every endpoint in the contract
(`frontend/app/src/data/repositories/http/endpoints.ts`; `backend/test/contract/coverage.test.ts` checks it). The
mock API that stood in for unbuilt endpoints during Waves 0–7 is no longer used by the backend; an old
`MOCK_API_URL` line in `backend\.env` is ignored and can be deleted.

## Checks

```bat
npm run typecheck
npm test
```

Backend tests use a separate database (`riona_test`, created automatically) and need `npm run db:up`.
The contract tests (`test/contract/`) check that every endpoint answers (`endpoints.test.ts`), and that the backend
returns exactly what the frontend's in-memory fixture returned before it was removed (its answers are kept in
`test/golden/fixture.json`), so the screens show the same numbers they always did. `dashboard.test.ts` checks the
server-computed dashboards equal what the browser used to compute.

The route gate visits every route as each role at 1440 and 390 px. Against the API it signs in as the demo
accounts (needs Playwright, and the backend and Vite running):

```bat
set GATE_PASSWORD=riona-demo-2026
rem /portal routes are visited by the Client account, the rest by the four staff roles
node frontend\app\scripts\gate.cjs http://localhost:5173 frontend\app\scripts\routes.txt
```

**Served by the backend: everything.** Every endpoint in the contract is answered by the backend (Wave 8), and
nothing is forwarded to a mock any more.

**Files** (`src/storage/files.ts`, `src/http/routes/uploads.routes.ts`): `POST /api/v1/uploads` takes the file as the
request body (name in `X-Filename`), checks its type against an allow-list (PDF, images, Office files, text, CSV,
ZIP; never HTML or executables) and size (`UPLOAD_MAX_MB`, default 10), and stores it under `STORAGE_DIR`
(default `backend/var/uploads`, git-ignored; mount a persistent volume in production). A download is a five-minute
link signed with `SESSION_SECRET`; the stored SHA-256 is checked before serving.

**Accounts:** HR adds a person (People › New hire), then an Admin invites them (Admin › Users) with the same email;
the invitation and "Forgot password" both send a link to `#/reset-password/:token`, where the person sets a password
and is signed in. Deactivating a user ends their sessions at once; the last active Admin can't be removed.

**Dashboards** (`GET /dashboard-facts`, `GET /dashboard-blocks`): the figures, hub attention lists and analytics
blocks are computed on the server, over what the signed-in person may see, with the same selectors the screens
used; the browser no longer loads every collection.

**Approval SLAs** (`engines/approvals/timeouts.job.ts`, every 15 minutes): when a step's SLA passes, its approver is
reminded once, or the step is approved automatically where the workflow's Approver step says "When the SLA passes:
approve automatically" (Admin › Workflows). The demo's workflows remind.

**Single sign-on** (`backend/src/auth/sso.ts`): Google and Microsoft, OpenID Connect with PKCE; the ID token's
signature, issuer, audience, expiry and nonce are checked, and only an active Riona account with that email is
signed in (SSO never creates accounts).

**Roles:** what the API enforces is the matrix in `backend/src/auth/rbac/permissions.ts` (plus the "IT" role name,
which manages assets and stock). Admin › Roles and Admin › Notification rules are stored and audited but don't yet
change enforcement or delivery.

**The client portal's walls** (`db/migrations/011_portal_rls.sql`, `src/http/plugins/portal-scope.ts`): portal
reads run in a read-only transaction as the Postgres role `riona_portal`, scoped to the signed-in client. That role
is granted only client-safe columns (no hours, assignees, internal notes, entry links, budgets or uploaders) and
row-level security limits every table to the client's rows, so even a broken query can't leak. The migration
creates the role and grants it to the app's database user, which therefore needs the CREATEROLE privilege when
migrating (the Docker database's user has it). `test/security/portal-scope.test.ts` tries the API and raw SQL.
Online payments: `PAYMENT_GATEWAY=simulated` (default outside production) confirms at once; a real gateway confirms by
signed `POST /api/v1/webhooks/payments` (`PAYMENT_WEBHOOK_SECRET`, see `.env.example`).

**Billing rules the database enforces** (`db/migrations/012_finance_guards.sql`): a timesheet entry can be on only one
live invoice, and only if it is approved, billable and the same client's; billed hours can't be edited or deleted;
payments can't exceed an invoice's total, which is frozen in `invoices.issued_totals` when it is issued; payments
and revisions are append-only. Cost rates for profitability come from the `entry_costs` view
(`db/views/profitability.sql`), and `test/invariants/reconciliation.test.ts` checks the server's figures equal the
frontend's selector.

## Contracts

- `frontend/app/src/data/repositories/http/endpoints.ts`: every endpoint, its route and how the arguments travel.
  Its signatures are in `frontend/app/src/data/repositories/contract.ts`. The HTTP client and the backend follow
  it, and a test round-trips each one.
- `frontend/app/HANDOFF.md`: the rules the API must enforce, and which screens call what.
- `packages/shared/src/errors.ts`: the error body every failure uses, `{ error: { message, code, fields?, requestId } }`.
