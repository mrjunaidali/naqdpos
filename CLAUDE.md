# NaqdPOS — instructions for AI coding sessions

NaqdPOS (formerly "ePOS"; working name) is an offline-first point-of-sale web app (PWA) for small shops in Pakistan:
fruit & veg shops and carts (rehri) first, then small grocery and meat shops.
It must work fully without internet and sync when a connection returns.

Read these before any work:
- `docs/architecture.md` — data model, sync design, auth and roles. **Source of truth.**
- `docs/deployment.md` — hosting, environments, settings, costs and how to move hosts.
- `docs/backlog.md` — epics, features, user stories (US###) with acceptance criteria.
- `docs/progress.md` — what is already built (update it at the end of every story).
- `docs/features/*.md` — detailed feature specs (rules, permissions, core functions) when a story points to one.

## Tech stack (do not add or swap libraries without asking)

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) everywhere |
| Monorepo | pnpm workspaces |
| Shop app | `apps/pos`: React 19 + Vite, `vite-plugin-pwa` (Workbox), React Router 8 |
| Admin portal | `apps/admin`: React + Vite (online only, system admin) |
| Shared logic | `packages/core`: pure TS domain logic (money, totals, khata, stock, closing), Zod schemas, shared types |
| Local DB | Dexie (IndexedDB) + `dexie-react-hooks` (`useLiveQuery`) — the UI reads from Dexie, never directly from the server |
| UI | Tailwind CSS; mobile-first; touch targets ≥ 44px |
| State | Dexie for data, Zustand for UI-only state |
| i18n | i18next; English + Urdu (RTL); every label goes through `t()` |
| API | `apps/api`: Node 24 LTS + Hono, `@hono/zod-openapi` (schemas from `packages/core`), pino logs |
| Auth | Better Auth in the API: Google sign-in + email OTP, TOTP 2FA for admins; phone OTP later (architecture §5) |
| Database | PostgreSQL with Row Level Security; Kysely on the `pg` driver; plain `.sql` migrations run by dbmate |
| Server logic | SQL functions for sync, closing and reports (called by the API); API routes stay thin |
| Jobs | pg-boss (queue in Postgres) in the worker entry of `apps/api` |
| Files | S3 API (`@aws-sdk/client-s3`) → Cloudflare R2 now; pre-signed URLs |
| Local dev | PostgreSQL installed on the developer PC (databases `naqdpos_dev`, `naqdpos_test`); MinIO in Docker only when file uploads are built |
| Tests | Vitest + Testing Library (apps, core); `fake-indexeddb` for Dexie; API and RLS tests in Vitest against the real `naqdpos_test` database (no pgTAP); Playwright for key end-to-end flows |
| Lint/format | ESLint + Prettier |

## Non-negotiable rules

1. **Offline first.** Every write in the shop app goes to Dexie first and into the sync outbox. Nothing in the selling flow may wait for the network.
2. **IDs are UUIDv7 generated on the device.** Never rely on server-generated IDs for synced records.
3. **Money is integer paisa** (`amount_paisa: number`, Rs 1 = 100). **Quantities are integer thousandths** (`qty_milli`, 1.5 kg = 1500). Never use floats for money or quantity. Use helpers in `packages/core/src/money.ts` and `qty.ts`.
4. **Ledgers are append-only.** `sales`, `sale_lines`, `payments`, `khata_entries`, `stock_movements`, `expenses`, `expense_attachments` are never updated or deleted. Corrections are new rows (returns, reversals, adjustments). Stock and balances are always *sums* of movements.
5. **Every row has `shop_id`.** Every server table has RLS (`enable row level security` in the same migration that creates the table, plus policies using `current_user_id()`). Never disable RLS. The API connects as `naqdpos_app` (no `BYPASSRLS`, owns nothing) and sets `app.user_id` in every transaction. Secrets live only in server env vars, never in app builds.
6. **Business date** is the shop's local date in `Asia/Karachi`, stored as `business_date` on ledger rows when they are created.
7. **Role checks** go through `packages/core/src/permissions.ts` in the client and API route checks plus RLS/SQL checks on the server — both, never only the UI.
8. **Schema changes** only via a new migration in `db/migrations/` plus the matching Dexie version bump in `apps/pos/src/db/schema.ts`. Never edit an old migration. Ask before changing a table described in `docs/architecture.md`.
9. Domain calculations (totals, discounts, change, khata balance, expected cash) live in `packages/core` as pure functions with unit tests — not inside React components or SQL only.

## Portability (no lock-in)

Every part must be movable to another host by changing settings, not code.

1. **Configuration only through environment variables.** Apps: `VITE_API_URL`. API/worker: `DATABASE_URL`, `S3_*`, `SMTP_*`, auth secrets (full list in `.env.example`). No host names, keys or vendor URLs in code.
2. **Standards only:** plain PostgreSQL (no vendor extensions without asking), S3 API for files, SMTP for email, Docker image for the API. Ask before adding any managed service or vendor SDK.
3. **Apps call the backend only through one typed client** (`apps/pos/src/api/`, `apps/admin/src/api/`) built on the shared Zod schemas. No `fetch` calls scattered in features.
4. **Everything in migrations.** The database must be rebuildable from `db/migrations` on an empty Postgres. No manual changes in a hosting dashboard.
5. **Files by key, not URL.** Store `bill-photos/<shop_id>/<expense_id>.jpg`; the API turns keys into pre-signed URLs.
6. **API is stateless.** No in-memory sessions, caches that matter, or local files; everything durable goes to Postgres or object storage.

## Repo layout

```
apps/pos/            shop app (owner, cashier, rider views)
  src/db/            Dexie schema, repositories, outbox
  src/sync/          sync engine (push/pull)
  src/features/<x>/  one folder per feature (products, sale, khata, closing, ...)
  src/i18n/          en.json, ur.json
apps/admin/          system admin portal
packages/core/       domain logic, zod schemas, types
apps/api/            API service (Hono routes, auth, SQL calls) + worker entry
db/migrations/       dbmate SQL migrations (tables, RLS, SQL functions)
db/tests/            Vitest tests for RLS and SQL functions (run against naqdpos_test)
docs/                architecture, deployment, backlog, progress
```

## How to implement a story ("Implement US0xx")

1. Read the story and its acceptance criteria in `docs/backlog.md`, and check `docs/progress.md` to see what exists.
2. Briefly list the files you will create or change and any schema change. If a schema change is needed that `docs/architecture.md` does not already describe, stop and ask.
3. Write tests first: one or more tests per acceptance criterion (core unit tests, component tests, RLS tests as relevant).
4. Implement the smallest change that makes the tests pass. Keep to the story — don't build ahead.
5. Run `pnpm test`, `pnpm lint`, `pnpm typecheck`. All must pass.
6. Add strings to both `en.json` and `ur.json` (Urdu may be a placeholder marked `TODO-ur`).
7. Append to `docs/progress.md`: story ID, what was built, files touched, any decision or follow-up.
8. Suggest a commit message: `feat(US0xx): <short summary>`.

## Product glossary

- **Khata** — customer credit ledger, keyed by customer mobile number.
- **FOC** — free of charge item (e.g. free mint/coriander/chillies with vegetables).
- **Mandi rate** — the day's wholesale market price; shops change prices daily.
- **Rehri** — hand cart vendor.
- **Combo** — a product made of set items in set quantities plus packaging cost (e.g. fruit basket).
- **Daily closing** — end-of-day cash count vs expected cash; locks the day.

## Roles

- **System admin** (platform owner): admin portal, all shops, can act on a shop's behalf (audit-logged).
- **Owner**: everything in their shop.
- **Cashier**: sell, khata, expenses; cannot see cost prices, profit, or total sales beyond their own shift.
- **Rider**: only their assigned active deliveries and their own cash-to-hand-over.

## Style

- Small components; feature folders; no default exports except route components.
- Names in English in code; user-facing text only via i18n.
- Prefer clear code over clever code. Comment the *why*, not the *what*.
