# NaqdPOS — instructions for AI coding sessions

NaqdPOS (formerly "ePOS"; working name) is an offline-first point-of-sale web app (PWA) for small shops in Pakistan:
fruit & veg shops and carts (rehri) first, then small grocery and meat shops.
It must work fully without internet and sync when a connection returns.

Read these before any work:
- `docs/architecture.md` — data model, sync design, auth and roles. **Source of truth.**
- `docs/deployment.md` — hosting (Railway + Supabase project `naqdpos`), environments, costs.
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
| Backend | Supabase: Postgres, Auth (Google sign-in + email OTP; TOTP for admins; phone OTP later — architecture §5), Row Level Security, Storage, Edge Functions (Deno) |
| Server logic | Postgres functions (RPC) for sync and reports; Edge Functions only for external calls (WhatsApp, SMS) and scheduled jobs |
| Tests | Vitest + Testing Library (apps, core); `fake-indexeddb` for Dexie; pgTAP or SQL tests via Supabase CLI for RLS and RPCs; Playwright for key end-to-end flows |
| Lint/format | ESLint + Prettier |

## Non-negotiable rules

1. **Offline first.** Every write in the shop app goes to Dexie first and into the sync outbox. Nothing in the selling flow may wait for the network.
2. **IDs are UUIDv7 generated on the device.** Never rely on server-generated IDs for synced records.
3. **Money is integer paisa** (`amount_paisa: number`, Rs 1 = 100). **Quantities are integer thousandths** (`qty_milli`, 1.5 kg = 1500). Never use floats for money or quantity. Use helpers in `packages/core/src/money.ts` and `qty.ts`.
4. **Ledgers are append-only.** `sales`, `sale_lines`, `payments`, `khata_entries`, `stock_movements`, `expenses`, `expense_attachments` are never updated or deleted. Corrections are new rows (returns, reversals, adjustments). Stock and balances are always *sums* of movements.
5. **Every row has `shop_id`.** Every server table has RLS (`enable row level security` in the same migration that creates the table, plus policies). Never disable RLS, never use the service role key in client code.
6. **Business date** is the shop's local date in `Asia/Karachi`, stored as `business_date` on ledger rows when they are created.
7. **Role checks** go through `packages/core/src/permissions.ts` in the client and RLS/RPC checks on the server — both, never only the UI.
8. **Schema changes** only via a new migration in `supabase/migrations/` plus the matching Dexie version bump in `apps/pos/src/db/schema.ts`. Never edit an old migration. Ask before changing a table described in `docs/architecture.md`.
9. Domain calculations (totals, discounts, change, khata balance, expected cash) live in `packages/core` as pure functions with unit tests — not inside React components or SQL only.

## Repo layout

```
apps/pos/            shop app (owner, cashier, rider views)
  src/db/            Dexie schema, repositories, outbox
  src/sync/          sync engine (push/pull)
  src/features/<x>/  one folder per feature (products, sale, khata, closing, ...)
  src/i18n/          en.json, ur.json
apps/admin/          system admin portal
packages/core/       domain logic, zod schemas, types
supabase/migrations/ SQL migrations (tables, RLS, RPC functions)
supabase/functions/  edge functions
supabase/tests/      SQL/RLS tests
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
