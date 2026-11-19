# NaqdPOS progress

What is already built. Append an entry at the end of every story (CLAUDE.md, "How to implement a story").

## Step 0 — skeleton (2026-11-17)

Empty monorepo skeleton. No features and no database tables.

**Built**
- pnpm workspaces (`pnpm@12.21.0`, Node `>=24`): `apps/pos`, `apps/admin`, `packages/core` (`@naqdpos/core`).
- TypeScript 6.0.3 strict, shared `tsconfig.base.json` (also `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Apps use `tsconfig.app.json` + `tsconfig.node.json` and `tsc -b`.
- `packages/core`: `money.ts` (paisa: `rupeesToPaisa`, `wholeRupeesToPaisa`, `paisaToRupeesString`, `sumPaisa`, `isPaisa`/`assertPaisa`) and `qty.ts` (`parseQty`, `unitsToQtyMilli`, `formatQty`, `priceForQty`, `isQtyMilli`/`assertQtyMilli`). Input is parsed from strings and multiplication uses BigInt, so floats never touch money or quantity. Rounding in `priceForQty` is half away from zero to whole paisa. The core package exports its TS source directly (no build step).
- `apps/pos`: React 19 + React Router 8 (data router, `createBrowserRouter`), Tailwind 4 (`@tailwindcss/vite`), `vite-plugin-pwa` (`registerType: 'prompt'`, manifest per architecture §6, iOS meta tags, Workbox precache of the app shell), placeholder icons (192, 512, maskable 512, apple-touch 180) made by `pnpm --filter @naqdpos/pos icons`, i18next with `en.json`/`ur.json` and `<html dir/lang>` switching (Urdu = RTL), Dexie `NaqdDb` schema **version 1 with only `meta` (key)**, Zustand installed (no stores yet), minimal "New version available — Reload" banner (`src/app/UpdatePrompt.tsx`).
- `apps/admin`: React 19 + React Router 8 + Tailwind 4, placeholder home page.
- Tooling: ESLint 10 flat config (typescript-eslint type-checked, react-hooks, react-refresh, prettier), Prettier, Vitest 5 (jsdom + Testing Library + `fake-indexeddb` in pos).
- Root scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `format`, `format:check`.
- A hosted-backend CLI folder (`init`, empty `migrations/`, `functions/`, `tests/`); removed in Step 2.
- `.env.example` (now `VITE_API_URL`), `.gitignore`, `.vscode/extensions.json`.

**Tests**: core 60 (money, qty); pos 9 (Dexie schema, i18n key parity + RTL, routes).

**Decisions**
- React 19 + React Router 8 instead of React 18 (CLAUDE.md updated). React Router 8 requires React 19.
- TypeScript 6.0.3, not 7.x, because typescript-eslint 8.73 supports only TypeScript `<6.1`.
- Admin portal is English-only for now (system-admin tool); no i18n there.
- pnpm added recently released packages to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` during install.

**Follow-ups**
- `UpdatePrompt` must hide while the cart has items (sale story).
- `navigator.storage.persist()` and `estimate()` on start, stored in `meta.storage_persisted` (architecture §6).
- Urdu font: add it and precache it (architecture §6). The Urdu tagline is marked `TODO-ur`.
- Persist the chosen language on the device.
- Install prompt (`beforeinstallprompt`) and the iOS "Add to Home Screen" guide (owner onboarding).
- Railway Caddyfile and deploy (deployment §2).
- `docs/backlog.md` does not exist yet.

## Step 1 — tenancy foundation (2026-11-18)

First database migration and the matching Dexie version. The migration was written for the hosted backend evaluated at the time and removed in Step 2 (still in git at `cb62f5c`); it is reworked for `db/migrations`. No UI yet.

**Built**
- `20261118200000_tenancy.sql` (removed in Step 2):
  - Tables `shops`, `memberships`, `staff`, `staff_salaries`, `devices`, `platform_admins`, `audit_log`, with RLS enabled in the same migration.
  - Global sequence `public.server_seq` plus a `set_server_seq()` BEFORE INSERT OR UPDATE trigger on the five synced tables. The trigger is security definer, so clients have no sequence privileges and any `server_seq` a client sends is overwritten.
  - Helpers `is_shop_member(shop_id)`, `has_shop_role(shop_id, roles[])` and `is_platform_admin()`. They are security definer with `search_path = ''`, executable by `authenticated` only, and only answer questions about the caller.
  - Policies: members read their own shop's rows. Only owners update `shops` (column grants keep `status`, `plan_id` and `deleted_at` for admin RPCs), insert or update `staff` and `devices` (devices also need `registered_by = auth.uid()`), and read or write `staff_salaries`. `memberships` are read-only to clients. `platform_admins` and `audit_log` have no client privileges at all. `anon` has no privileges on any tenancy table. There are no delete policies (soft delete).
  - RPC `create_shop(p_shop_id, p_name, p_type, p_owner_staff_id, p_owner_name, p_owner_phone, p_shop_phone, p_address?, p_device_id?)`. In one transaction it creates the shop, the caller's owner membership, the owner staff row and a `shop.create` audit row. A retry by the same owner returns the id. Another user reusing the id gets `23505`, and a call without a signed-in user gets `42501`.
- `packages/core`: `tenancy.ts` (row types `ShopRow`/`StaffRow`/`DeviceRow`, `SHOP_TYPES`, `ROLES`, defaults) and `permissions.ts` (`canManageShop`, `canManageStaff`, `canSeeSalaries`, `canManageDevices`, each mirroring an RLS policy).
- `apps/pos/src/db/schema.ts`: Dexie **version 2** adds `shops (id, server_seq)`, `staff (id, shop_id, server_seq)` and `devices (id, shop_id, server_seq)`. `memberships`, `staff_salaries`, `platform_admins` and `audit_log` are not stored on the device.

**Tests**: pgTAP 73 in 3 files (`tenancy_rls`, `tenancy_create_shop`, `tenancy_server_seq`; removed in Step 2). Core 72 (+12 permissions). Pos 13 (Dexie v2 tables and indexes, no private tables, tenancy row round-trip, v1 → v2 upgrade keeps `meta`). DB lint: clean.

**Decisions**
- Salary moved to a separate owner-only table, `staff_salaries` (like `product_costs`), instead of column privileges. `sync_pull` can then skip it for shop and rider devices. Architecture §3/§5 and the expense feature doc are updated.
- `devices.code` added (receipt prefix from §4, `^[A-Z][0-9]{1,3}$`, unique per shop).
- `memberships` primary key is `(shop_id, user_id)`; rows are only created on the server.
- Enumerations are `text` + `check`, not Postgres enums.
- `audit_log.id` is server-generated (`gen_random_uuid()`), because it is never synced.
- No `staff.active` index in Dexie: IndexedDB cannot index booleans; filter after `shop_id`.
- pgTAP files each define small `tests.login()` / `tests.row_count()` helpers inside the test transaction (rolled back).

**Follow-ups**
- **Security:** every shop member, including riders, can read every `staff.pin_hash`, and a hashed 4-digit PIN can be brute-forced instantly. Shop devices need it offline, but riders should not get it. Restrict this when rider device sync is designed.
- Device mode (owner, shop or rider device, §4) is not stored yet. Decide in the device registration story.
- Admin RPCs for shop `status` and `plan_id`, and soft-deleting a shop.
- Membership management (invites) is still open (§8). Until then memberships come only from `create_shop`.
- `staff_salaries` is not in Dexie yet. Add it for owner devices with US071.
- Not pushed to the cloud project.

## Step 2 — switch to own backend (2026-11-19)

The hosted backend was dropped (deployment §6). Docs now describe our own API: Node + Hono, PostgreSQL with RLS, Better Auth, S3-compatible storage.

**Changed**
- `CLAUDE.md`, `docs/architecture.md`, `docs/deployment.md` updated for the own backend.
- Removed the old backend folder (config, tenancy migration, pgTAP tests) and its CLI dev dependency.
- `.env.example`: only `VITE_API_URL=http://localhost:8787`. Local `apps/*/.env.local` files deleted.
- Comments in `schema.ts` and `permissions.ts` point to `db/migrations`; bill photos go to object storage (expense feature doc).
- Dev PC: local containers stopped, Docker images deleted, CLI logged out and its config folder removed.

**Follow-ups**
- Rework the tenancy migration (git `cb62f5c`) into `db/migrations` for dbmate, with RLS tests in Vitest (`db/tests`) using `current_user_id()` instead of `auth.uid()`.
- Create `apps/api` (Hono) and the typed API clients.
- Delete the evaluation cloud project once nothing uses it (deployment §6).

## Step 3 — own backend foundation (2026-11-19)

Postgres schema with RLS, the API service with auth, and the typed client. No UI changes.

**Built**
- `db/` workspace package (`@naqdpos/db`). Root scripts run `db/scripts/db.ts` with plain Node and never print connection strings:
  - `db:create`: creates `naqdpos_dev`, `naqdpos_test` and the login role `naqdpos_app` (generated password, `NOBYPASSRLS`), and writes `DATABASE_URL`, `TEST_DATABASE_URL` plus local defaults (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ORIGINS`) into `.env`. Safe to rerun: a working password is kept.
  - `db:up`, `db:new <name>`, `db:reset` (drop, create, migrate dev), `db:test` (rebuild `naqdpos_test` from migrations, then run `db/tests` and the API's `*.db.test.ts`).
  - dbmate runs as the owner role (`DATABASE_ADMIN_URL`) with `--no-dump-schema` (no `pg_dump` needed) and `sslmode=disable` for localhost only.
- `db/migrations/20261119120000_foundation.sql`:
  - creates `naqdpos_app` `NOLOGIN` if missing (hosts set the password once); revokes `create` on `public` and default `execute` on new functions
  - `current_user_id()` reads `app.user_id`
  - Better Auth tables `users`, `sessions`, `accounts`, `verifications`, `two_factors` (snake_case, uuid ids), with RLS open only when `app.context = 'auth'` (architecture §5)
  - `server_seq`, the tenancy tables, helpers, grants, policies and `create_shop()`, reworked from `cb62f5c`: `current_user_id()` instead of `auth.uid()`, `users` instead of `auth.users`, `naqdpos_app` instead of `authenticated`/`anon`
- `apps/api` (`@naqdpos/api`): Node 24 + Hono + `@hono/zod-openapi`, Kysely on `pg`, pino.
  - `env.ts`: Zod-validated settings at startup (empty = not set; errors name variables, never values).
  - `db/index.ts`: `withUserTx(db, userId, fn)`, one transaction with `set_config('app.user_id', …, true)`.
  - `auth.ts`: Better Auth at `/auth/*` with email OTP (6 digits), two-factor (TOTP), bearer tokens (`set-auth-token` header), account linking. Google is on only when both keys are set. OTP codes are logged only when `NODE_ENV=development`; otherwise sending fails until SMTP is chosen.
  - Routes: `GET /health` (503 when the DB is down), `POST /shops` (calls `create_shop`; 201 / 400 / 401 / 409), `GET /openapi.json`. CORS from `APP_ORIGINS`.
  - No build step: Node runs the TypeScript (type stripping, `erasableSyntaxOnly`). `pnpm --filter @naqdpos/api dev` (port 8787) sets development via `src/dev.ts`.
  - `auth:schema` script prints any SQL Better Auth still needs (use it after upgrades).
  - `Dockerfile` (`node:24-alpine`, prod deps only, non-root) and `.dockerignore` (keeps `.env` out).
- `packages/core/src/api/`: shared Zod contract (`HealthResponse`, `CreateShopRequest`, `CreateShopResponse`, `ErrorResponse`) and `createApiClient` (bearer token, parses every response, `ApiError`). `zod` added to core.
- `apps/pos/src/api/` and `apps/admin/src/api/`: the client bound to `VITE_API_URL` (not used by features yet). Both Vite configs read the root `.env` (`envDir`).
- `.env.example`: every deployment §2 variable without values, plus `TEST_DATABASE_URL`, `PORT`, `LOG_LEVEL`.

**Tests**: DB 34 in 5 files (`db/tests`: role attributes and ownership, RLS on every table, no-user and outsider see nothing, shop A vs B reads and writes, cashier vs owner on shops/staff/staff_salaries/devices, admin-only shop columns, no deletes, `server_seq` on insert and update, `create_shop` incl. retry/23505/42501/audit row, auth tables closed to tenant queries). API DB 7 (email OTP sign-in, wrong code, bearer token, `POST /shops` read back through RLS, retry, 409, 401, 400). API unit 11, core 77 (+5 client), pos 13. Docker image built and started.

**Decisions**
- One `naqdpos_app` role for both pools; the auth tables are separated by `app.context`, not by a second role (no extra env var).
- The migration owner is whatever role runs `DATABASE_ADMIN_URL` (`postgres` locally); no separate owner role yet.
- `NODE_ENV` is not in the shared `.env`, because Vite reads that file too and would build in development mode.
- Better Auth's rate limiter uses its default in-memory store. OTP attempts are limited in the database (`verifications`).

**Follow-ups**
- SMTP provider and mailer (architecture §8); until then email OTP works only in development.
- Rate-limit storage that works across API copies (needs a table; ask before adding).
- `/admin/*` routes must require a session that passed 2FA.
- `app.device_id` is not set yet (needed with device registration and sync).
- Worker entry (pg-boss) and S3 file routes.
- Staging: create `naqdpos_app` login and password on the host, run migrations from CI.
- Rider PIN-hash exposure (from Step 1) still open.

## Step 4 — owner sign-in, onboarding and device registration (2026-11-20)

The owner signs in, creates a shop and registers the device; afterwards the app opens straight to home, also offline.

**Built**
- Migration `20261120090000_onboarding.sql`:
  - `create_shop()` gains `p_owner_pin_hash` (old signature dropped)
  - new `register_device(id, shop_id, name)`: owner only (explicit check, it is security definer), locks the shop row so concurrent registrations get different codes, codes `A1…A999` then `B1…`, idempotent on retry, `23505` for a device id in another shop, writes `device.register` to `audit_log`
- `packages/core`:
  - `phone.ts`: `normalizePkMobile()` (03…, +92…, 92…, 0092…, spaces and dashes) to `+923XXXXXXXXX`, `isPkMobile`, `formatPkMobile`
  - `pin.ts`: `hashPin` / `verifyPin`, PBKDF2-SHA256 via WebCrypto, 100,000 iterations, 16-byte salt, `pbkdf2-sha256$iter$salt$hash`, constant-time compare
  - `ids.ts`: `uuidv7()` (no new dependency); core now has the DOM lib for WebCrypto types
  - API contract: row schemas (`ShopRowSchema`, `StaffRowSchema`, `DeviceRowSchema`), `ConfigResponse`, `MeResponse`, `RegisterDeviceRequest`, auth responses; `CreateShopRequest` requires a Pakistani `owner_phone` and `owner_pin_hash`
  - client: `config`, `sendSignInCode`, `signInWithCode`, `googleSignInUrl`, `exchangeOneTimeToken`, `getSession`, `signOut`, `me`, `registerDevice`; sends `X-Device-Id`; Better Auth errors and network failures become `ApiError` (`status 0` = offline)
- `apps/api`:
  - `GET /config` (`{ google }`), `GET /me` (user + shops with role and own staff row, through RLS), `POST /devices` (201/400/401/403/409)
  - `requireUser` puts the user and `{ userId, deviceId }` on the request; `withUserTx` now also sets `app.device_id`; a malformed `X-Device-Id` is a 400; CORS allows the header
  - Better Auth: sessions 90 days (`updateAge` 1 day); one-time-token plugin (server-minted only, hashed, 1 minute, no cookie); `/auth/callback/*` goes through `addOneTimeTokenToRedirect`, which adds `#ott=…` only for redirects to `APP_ORIGINS` and strips `set-auth-token`
- `apps/pos`:
  - `src/db/session.ts`: `meta` keys `session` (token, user, email, last check) and `device` (id, code, shop, staff); `src/api/index.ts` reads token and device id from Dexie
  - `useAppState()` (Dexie only: `signed-out` / `setup` / `ready`) and `<Gate>` on `/`, `/sign-in`, `/setup`; daily background session check (signs out only when the server says the session is gone; offline is ignored)
  - `features/auth`: `SignInPage` (email, code with `one-time-code` numeric input, resend, change email, offline notice, Google button only if `/config` says so), `GoogleCallbackPage` (+ `oneTimeToken.ts`, redeems once even under StrictMode)
  - `features/onboarding`: `SetupPage` asks `GET /me` first, so an owner on a second device gets `RegisterDeviceForm` instead of a second shop; `OnboardingForm` (shop name, type with `fruit_veg` default, owner name, mobile, PIN + confirm, device name) with ids kept for safe retries; `setup.ts` stores shop, own staff row, device and the `device` meta key in one Dexie transaction
  - home shows the shop name and device code; small `ui/` pieces (`Field`, `Button`, `Alert`, error messages)
  - en + ur strings for every label (`TODO-ur` where unsure)
- No Dexie version bump: v2 already has `shops`, `staff`, `devices`; session and device live in `meta`.

**Tests**: DB 43 (+9: `register_device` codes, separate numbering per shop, retry, 5 concurrent registrations, refusals for cashier / other owner / outsider / no user, 23505, empty name, audit row, `B1` after `A999`; `create_shop` stores the PIN hash). API DB 23 (+16: 90-day session, one-time token single use / reuse / expiry / made-up / client cannot mint / stored hashed, `/me` empty, own and other's shops, `/devices` A1→A2, retry, 403, 409, 401/400, `app.device_id` set and empty). API unit 25 (+14: `/config`, 401s, bad device header, Pakistani mobile, OAuth callback routing, redirect token hand-off incl. foreign origin and error redirects, `requireUser` context). Core 111 (+34: mobile, PIN, uuidv7, client). Pos 47 (+34: sign-in, Google button and callback, onboarding validation and success, retry with same ids, existing owner, cashier, offline home, gates, session check). Live check against the dev API: sign-in → shop → device `A1` → `/me`.

**Decisions**
- Google hand-off uses Better Auth's one-time-token plugin; the token rides in the URL fragment so static hosts never log it.
- Onboarding rows (shop, staff, device) are created on the server and stored in Dexie like pulled rows, not through the outbox: onboarding needs the network anyway.
- The owner's mobile is used for both `staff.phone` and `shops.phone`.
- A user who is only a cashier or rider sees "only the owner can set up a device".

**Follow-ups**
- Google sign-in is untested end to end until Google keys exist, and must be tried on iOS (§5).
- Shop picker for owners with several shops (now: first owner shop).
- Sign-out UI; and what happens when a different user signs in on a registered device.
- Install prompt as an onboarding step (§6) and `navigator.storage.persist()`.
- PIN lock after 5 wrong tries (with the PIN switch story).
- Rider PIN-hash exposure (Step 1) still open: `/me` returns only the caller's own staff row.
