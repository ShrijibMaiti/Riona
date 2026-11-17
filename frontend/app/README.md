# Riona frontend

This is a React 18 + Vite + TypeScript build of the Riona designs in `../project/`. It has three apps behind one entry:

- **The internal app** (`#/app`): six hubs, My Space and a cross-hub approvals queue.
- **The client portal** (`#/portal`).
- **The public site** (`#/`), ported from Landing v2, plus sign-in, password reset and the `#/setup/:token` wizard.

Every read and write goes through `src/data/repositories/`, one function per API endpoint
(`repositories/contract.ts` for the signatures, `repositories/http/endpoints.ts` for the routes), served by the backend
in `../../backend`. The in-memory fixture and seed this app started with were removed once every endpoint was built
(Wave 9); the demo data now lives in the backend. **`HANDOFF.md`** is the original API contract and its rules.

```sh
npm install
npm run dev         # http://localhost:5173/  (landing) · /#/app (internal app) · /#/portal (client portal)
npm run typecheck
npm test            # contract round-trip + data-boundary tests (vitest)
npm run build
```

## Checks

```sh
npm run lint                     # react-hooks: rules-of-hooks + exhaustive-deps, both errors; no disable comments in src
npm test                         # reconciliation + swap boundary
npx vite preview --port 4173 &   # after npm run build
npm run flows http://localhost:4173   # product flows: new invoice, compensation ledger, dual-state records
npm run a11y http://localhost:4173    # axe-core over 12 representative routes at 1440 and 390; fails on serious/critical
```

## Quality gate

```sh
npm run build && npx vite preview --port 4173 &
node scripts/gate.cjs http://localhost:4173 scripts/routes.txt [screenshotDir]
```

The gate visits every route in `scripts/routes.txt` as Admin, HR, Manager and Employee at 1440 px and 390 px. It fails
on console errors, page errors, horizontal scroll, or a page still loading after 8 s. To limit the roles, set
`ROLES=Admin`.

## Settings via query string

`?role=Admin|HR|Manager|Employee` · `?blocks=Violet|Ember|Mono` · `?dropdown=hover|click` · `?org=Acme`

Sign in with a demo account (see the root README). The account's role decides which hubs and actions are shown.

## Layout

| Path | What |
|---|---|
| `src/data/types` | Domain types: the shapes the API must return |
| `src/data/repositories` | One async function per endpoint (`contract.ts`, `http/`) |
| `src/data/selectors` | Pure calculations: payslips, GST, profitability, leave balances, facts |
| `src/lib/query.ts` | Query cache with domain invalidation |
| `src/screens/<hub>` | Screens, one lazy chunk per hub |
| `src/portal`, `src/public` | Client portal and public site |
| `src/components` | Shared UI: DataTable, ApprovalQueue, KanbanBoard, TimelineGantt, CalendarView, dialogs… |

## Images

The two background images live in `public/assets/` as WebP (served) and PNG (fallback for browsers without WebP).
`components/BgPicture.tsx` renders them as `<picture>` with `object-fit: cover`, in place of the design's CSS backgrounds.
The hero and dashboard images load eagerly; the security and closing-banner images load lazily. WebP is quality 95:
decoded, no pixel differs from the PNG by more than 8/255.
