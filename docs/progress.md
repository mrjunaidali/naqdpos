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

## Step 5 — sync engine: outbox, push/pull, health (2026-11-20)

Local writes are queued in an outbox and synced in the background; the header shows sync health and a Sync screen lists rejected entries. Architecture §3, §4, §6 and §7 are updated to match.

**Built**
- Migration `20261120150000_sync.sql`:
  - `devices.mode` (`owner` | `shop` | `rider`, default `shop`); `register_device(id, shop_id, name, p_mode default 'shop')` (old signature dropped, mode in the audit payload)
  - devices get their own `server_seq` trigger: changes to only `last_sync_at` / `last_seq_pulled` keep the old `server_seq`, so a pull never makes the device row "new" again; a client-sent `server_seq` is still overwritten
  - `sync_tables` registry (kind, id/shop columns, pushable, `push_columns`, `pull_scope`), rows for `shops` (settings only), `staff` (without `membership_user_id`), `staff_salaries` (`owner_device`) and `devices` (pull only)
  - `sync_conflicts` (owners read, members insert), `is_day_closed()` stub (returns false until `day_closes` exists)
  - `sync_device()` (42501 unless the device is visible to the user and not removed), `sync_mark_device()` (security definer bookkeeping), `sync_push()` and `sync_pull()` as security invoker with dynamic SQL driven only by the registry (`format('%I')`)
- `packages/core`:
  - `syncHealth.ts`: §7 thresholds as `SYNC_THRESHOLDS`; `update_required`, `auth_required`, `device_unlinked` are warnings; reasons listed most severe first; unknown storage state never alarms
  - `appVersion.ts`: `compareVersions`, `isAppVersion`, `isOlderThan` (missing or malformed = older)
  - `sync/tables.ts` (`SYNC_TABLES`, `OWNER_DEVICE_TABLES`, `isSyncTable`), `sync/schemas.ts` (`SyncPushRequest` ≤ 200 entries, `SyncPushResponse`, `SyncPullQuery`, `SyncPullResponse`; table names and error codes are plain strings so a newer server never breaks an older app)
  - `DEVICE_MODES`, `DeviceRow.mode`, `StaffSalaryRow` + schema; `RegisterDeviceRequest.mode` defaults to `shop`; `ErrorResponse` has `upgrade_required` and `min_version`
  - client: `appVersion` option → `X-App-Version` on every request; `syncPush`, `syncPull`; `ApiError.minVersion` on 426
- `apps/api`:
  - `MIN_APP_VERSION` (optional, checked as `x.y.z`; in `.env.example`); CORS allows `X-App-Version`
  - `routes/sync.ts`: `POST /sync/push`, `GET /sync/pull`. Version gate (426 `{ error: 'upgrade_required', min_version }`) runs before auth and only on `/sync/*`; `device_id` must equal `X-Device-Id` (400); rows checked against their table schema (bad row = per-entry `invalid`); 42501 from SQL = 403
  - `POST /devices` passes the mode
- `apps/pos`:
  - Dexie **version 3**: `outbox (id, table, row_key)`, `sync_errors (id, table)`, `staff_salaries (staff_id, shop_id, server_seq)`
  - `db/outbox.ts`: `localWrite` / `localWriteMany`, one `rw` transaction for rows + outbox entries, pull-only tables refused, `onLocalWrite` listeners
  - `sync/engine.ts` (`createSyncEngine`, injected API, timers and events): push in batches of 200, pull until `has_more` is false, conflicts take the server row, errors move to `sync_errors`, pulled rows skip ids with a pending local edit, unknown tables skipped; triggers start / `online` / write (5 s debounce) / 60 s / Sync now; backoff 5 s → 15 s → 60 s → 5 min; 426, 401, 403 pause with no retries (state in `meta.sync_state`); a new app version clears "update required" on start; Sync now re-queues `clock_ahead` entries with future timestamps clamped to now
  - `sync/index.ts` (the app's engine, started in `main.tsx`), `sync/state.ts`, `useSyncStatus` (Dexie + online + storage estimate → `syncHealth`)
  - header: `<BrandMark />`, shop name, sync chip (green "Synced", amber "N pending" / "Sync paused", red "Needs review") linking to `/sync`
  - `features/sync/SyncPage`: what is waiting, reasons, last sync, Sync now, rejected entries (clock_ahead → `sync.clockAhead`), auth messages
  - `UpdateRequiredBanner` (persistent, Reload only with an empty cart); `NewVersionBanner` hides while the cart has items or an update is required; `app/swUpdate.ts`: `registration.update()` every 60 min while online, on visibility and focus, and on 426
  - `features/sale/cartStore.ts` (Zustand, `itemCount` only)
  - onboarding and "Add this device" ask "Who uses this device?" (default Shop counter); the device name follows the mode until edited; `meta.device.mode` stored
  - `theme/default.css`: colour tokens as Tailwind 4 `@theme` variables; new and touched components use tokens only
  - `__APP_VERSION__` from `package.json` via Vite `define`
  - `sync.*` and `device.mode*` strings in en and ur (`TODO-ur`), plurals for counts

**Tests**: DB 66 (+23 in `sync.test.ts`: same batch twice, newer wins, older/equal-different → conflict with server row returned and logged, other shop per entry, hijacking another shop's row, owner-only table from shop vs owner device, cashier refused by RLS, shop settings without server columns, clock_ahead at 60 vs 5 min, unknown / pull-only tables, foreign / removed / unknown device and no user, throwaway ledger table for append-only idempotency, `day_closed`, `clock_ahead` on `created_at` and pull; pull paging, cursor and bookkeeping, owner vs shop device visibility, never another shop's rows, cashier never gets salaries; device `server_seq` trigger; mode stored, invalid mode, cashier cannot change mode). API DB 26 (+3: push twice and pull back over HTTP, bad row → per-entry invalid, 403 for another shop's device). API unit 35 (+10: 426 for older / missing / malformed versions, before auth, equal and newer pass, unset accepts all, only `/sync/*`, device mismatch 400, > 200 entries 400, CORS header, `MIN_APP_VERSION` env). Core 145 (+34: syncHealth thresholds and boundaries, versions, sync schemas and registry, client header, push/pull, 426). Pos 84 (+37: outbox atomicity incl. batch and caller rollback; Dexie v3 + v2→v3 upgrade; engine batching and paging, rejected entries, conflict convergence, pending-edit protection, unknown tables, offline/unregistered, triggers, debounce, backoff sequence and reset, tick waits for backoff, 426 pause + outbox kept + local writes + update check + cleared after reload, 401/403 pause without sign-out and Sync now recovery, clock_ahead re-queue; chip states, Sync screen, update banners and cart rule, SW update checks; onboarding mode question). `pos` production build checked.

**Decisions**
- Equal `updated_at` and equal content = a retried push, not a conflict (otherwise resending a batch would log false conflicts).
- Conflicts return the server row and the device stores it (convergence); conflict entries count as done, not as errors.
- The version gate answers 426 before the session check, and a missing version counts as older while `MIN_APP_VERSION` is set.
- `clock_ahead` uses the server's `now() + 10 min`; "Sync now" clamps future timestamps to the corrected device time before re-pushing.
- Registry rows are per layer: one row in `sync_tables` (SQL) plus one entry in `SYNC_TABLES` (core). SQL cannot read the TS registry.
- `sync_push` and `sync_pull` are security invoker; only the bookkeeping helper is security definer.
- Shop settings are pushable, but only the columns owners may already update; `shops` rows cannot be created by push (no insert grant).
- Pull results are filtered by the device's shop as well as RLS, so an owner of two shops never mixes them on one device.

**Follow-ups**
- Switching a device from owner to shop mode (not built yet; only owners may) must clear owner-only Dexie stores (`OWNER_DEVICE_TABLES`: `staff_salaries`, later `product_costs`) and reset the pull cursor.
- The daily session check (`sessionCheck.ts`) still signs out on 401. With a non-empty outbox that conflicts with §7's guarded logout. Decide whether to keep the session and rely on the sync `auth_required` state.
- "Sign in again" and "re-link device" actions on the Sync screen (now only messages).
- §7 reminder toast, warning/critical banners on the sell screen, "Synced N records" toast, and "Saved offline" line on receipts: with the sale story (hooks: `onSynced`, `useSyncStatus`).
- `navigator.storage.persist()` request and the export/import backup (§6) are still open; `useSyncStatus` only reads `persisted()` and `estimate()`.
- `day_closes` migration must replace `is_day_closed()`.
- Rider devices: pull scope for riders (deliveries only) and the PIN-hash exposure from Step 1.
- Older screens (sign-in, onboarding fields, buttons) still use palette classes; move them to theme tokens. The header has no bell yet (no notifications).
- Live check of push/pull against the dev API from a browser (covered by HTTP tests against `naqdpos_test`, not tried by hand).

## Step 6 — US017 staff, US016 PIN switch, US018 permissions (2026-11-20)

Owners manage staff offline; staff switch in from the header with a PIN checked offline; role checks go through `can()` on the client and are enforced by RLS, `sync_push` and API routes. PIN hashes no longer reach rider devices. The session is never cleared automatically, and sign-out is guarded.

**Built**
- Migration `20261120170000_staff_pins.sql` (decisions 1 and 2, approved 20 Nov 2026):
  - `staff_pins` (staff_id pk, shop_id, pin_hash, timestamps, composite FK to staff): RLS: owners read and write, cashiers read, riders only their own row; existing hashes copied, `staff.pin_hash` emptied and removed from staff's `push_columns`
  - `sync_tables.pull_scope` gains `counter_device` (owner and shop devices); `sync_scope_allows(scope, mode)` is used by both `sync_pull` and `sync_push`
  - `sync_tables.write_roles` (`{owner}` for shops, staff, staff_salaries, staff_pins); `sync_push` refuses with `forbidden` unless the entry's `actor_staff_id` is an active staff member of the device's shop with one of those roles
  - `create_shop` writes the owner's PIN to `staff_pins`
  - down migration restores everything, including the hashes in `staff`
- `packages/core`:
  - `permissions.ts`: `can(role, action)` with `ACTIONS` (`manage_staff`, `manage_devices`, `see_salaries`, `see_cost_prices`, `see_reports`, `manage_shop_settings`); replaces the four separate helpers
  - `pinLock.ts`: 5 failures → 60 s lock, ignores attempts while locked, fresh count after a lock, success resets
  - `staff.ts`: `validateStaffForm` (optional Pakistani mobile; PIN required on add, blank keeps it on edit), `keepsAnActiveOwner`, `canSwitchIn`
  - `StaffPinRow` + schema, `staff_pins` in `SYNC_TABLES` (`counter_device`), `actor_staff_id` on push entries
- `apps/api`: `POST /devices` checks `can(role, 'manage_devices')` from the caller's membership before `register_device` (which checks again); `db/roles.ts` `shopRole()`
- `apps/pos`:
  - Dexie **version 4**: `staff_pins (staff_id, shop_id, server_seq)`; outbox entries carry `actor_staff_id`
  - `staff/currentStaff.ts`: Zustand store persisted to `meta.current_staff` (falls back to the setup owner); `useCurrentStaff()` marks deactivated staff invalid
  - `db/outbox.ts`: actor from the current staff member, or an explicit acting owner; `db/actor.ts`: `stampActor(row)` adds `staff_id` + `device_id` (hook for ledger rows)
  - `features/pin/`: `attemptPin` (offline PBKDF2 check, lock in `meta.pin_lock`, deactivated → `not_allowed` without counting), `PinPad` (44 px+ keys, live countdown), `StaffPinPicker`, `SwitchStaffDialog`, header `StaffChip` ("Ali · A1"; forced "Who is working?" when the current staff member is no longer valid), `OwnerPinGate` + `ActingOwnerContext`
  - `features/staff/`: list, add/edit form, deactivate/reactivate, `staffRepo` (staff + staff_pins rows in one `localWriteMany`, last-owner guard); `/staff` routes share one owner check per visit
  - `features/settings/`: Staff link (owners only, `can`), Sync, language, sign-out blocked while the outbox has entries (Sync now), otherwise server sign-out (best effort) + local session cleared; device and data stay
  - session check never clears the session: 401 or a null session sets `auth_required`; Sync screen "Sign in again"; `SignInGate` opens `/sign-in` on a ready device only in that state; `completeSignIn` applies the re-sign-in rules (same user / other user with outbox / other user of this shop / other shop); `SignInBlocked` with Sync now; `apiWithToken()` checks the new user's shops before the session is replaced
  - setup stores the owner's PIN locally, sets the current staff member and runs `syncNow()`
  - header: brand mark, shop name, staff chip, sync chip, settings (language moves to Settings once ready)
  - theme tokens in `Button`, `Field`, `Alert`, sign-in, Google callback, onboarding, home and 404; no palette classes left in `apps/pos/src`
  - en + ur strings (`role.*`, `staff.*`, `pin.*`, `settings.*`, re-sign-in messages), plurals for counts

**Tests**: DB 75 (+9: `staff_pins` RLS by role and shop, owner-only writes, composite FK, staff no longer pushes `pin_hash`, owner/shop devices pull PINs and rider devices don't, staff rows carry no hash, actor owner accepted, actor cashier / missing / inactive / other shop refused, cashier actor on staff refused, rider device can't push PINs; existing sync tests send an actor; `create_shop` stores the PIN in `staff_pins`). API DB 26 (updated: PIN in `staff_pins`, `/me` staff without hash, push with actor, shop device pulls `staff_pins`). API unit 35. Core 168 (+23: `can()` for every role × action, PIN lock, staff validation, last owner, switch-in rule). Pos 115 (+31: staff add through the outbox with actor and hashed PIN, form validation, edit with blank PIN, deactivate and last-owner refusal, Staff hidden for cashiers, owner PIN gate on shop device and with a cashier switched in, owners-only on the gate; PIN switch success and reload, wrong PIN, lockout and reload during lockout, unlock after a minute, deactivated refused without counting, forced switch when the current staff member is deactivated; `stampActor`; outbox actor; engine sends the actor; session kept on 401 and null session; re-sign-in rules; sign-out blocked with outbox and allowed when empty, offline sign-out; "Sign in again" route). `pos` production build checked.

**Decisions**
- PIN hashes in `staff_pins` (option b), `counter_device` scope, `write_roles` with the acting staff check, lock per device, re-sign-in rules, owner PIN on shop devices, staff rules: as approved (plan of 20 Nov 2026).
- Validity of the current staff member is active and not deleted; a missing PIN row does not force a switch (a second device may not have pulled PINs yet).
- Language switching moves to Settings once a device is ready, to keep the header to brand, shop, staff, sync and settings.
- Callers that wrap `localWrite` in their own Dexie transaction must include `meta` or pass `actorStaffId`.
- Old app builds that push owner-only tables without `actor_staff_id` now get `forbidden` (pre-pilot, no devices in the field).

**Follow-ups**
- Drop `staff.pin_hash` once no old app versions remain.
- Rider devices: which staff row a rider device belongs to, and unlocking with the rider's own PIN (rider stories); rider pull scope (deliveries only).
- US018 remainder: cashier sees only own-shift sales (with sales), "shop device never receives `product_costs`" test (with products; same `owner_device` scope as `staff_salaries`).
- Switching a device from owner to shop mode must clear owner-only stores (Step 5 follow-up, still open; no UI to change mode yet).
- Offline sign-out with owner PIN after a backup export (§7) — needs the backup export.
- Header bell and the Home screen design (hero card, nav bar) are not built yet.

### Step 6 fixes (2026-11-20)

Two rules tightened after review (the Step 6 plan had said a flat 1-minute lock and "any member of the shop"):
- **Escalating PIN lock:** 5 wrong tries lock for 1 minute, the next lockout 5 minutes, every further one 15 minutes (`PIN_LOCK_STEPS_MS` in core). A correct PIN resets the failures and the lockout level. `meta.pin_lock` gains `lockouts`; `normalizePinLock()` loads states saved without it. Locks over a minute show in minutes (`pin.lockedMinutes`).
- **Owner-only re-sign-in:** another user signing in on a set-up device must be an `owner` of its shop (`/me` role); a cashier or rider gets `not_owner` ("Only the shop owner can sign in on this device") and the session is not replaced.
- Architecture §5 and the US016 acceptance line updated.

**Tests**: core 171 (+3 net: each lock step, staying at 15 min, reset after success, old state loads). Pos 119 (+4: escalation through `attemptPin` and reset, reload during a 5-minute lock, old saved state, cashier and rider refused with the session kept).

## Step 7 — US019 products, US021 categories, US072 produce presets, US020 today's rates (2026-11-21)

Owners manage the catalogue offline: products (English and Urdu names, unit, category, sale price, owner-only cost, other names / spellings), categories, the built-in fresh produce list and a one-screen "Today's rates". Product search matches English, Urdu and Roman Urdu.

**Built**
- Migration `20261121090000_catalogue.sql`: `categories`, `products` (every §3 column with safe defaults plus `search_terms text[]`, checked by `search_terms_ok()`), `product_costs`, `price_history` (sale prices only) and `product_cost_history` (decisions 2a/2b, 20 Nov 2026). Composite FKs keep categories, costs and history in the product's shop. RLS on all: members read products, categories and sale history; owners write; costs and cost history are owner-only. The two history tables have no update privilege (append-only). Registered in `sync_tables` with `write_roles {owner}`; costs and cost history `owner_device`.
- `packages/core`:
  - `catalogue.ts`: row types, `PRODUCT_UNITS`, `validateProductForm` (name required, unit, sale price ≥ 0 in rupees → paisa, optional cost, search term limits), `parseRupees`, `parseSearchTerms` (comma or Urdu comma), `displayName` (current language, fallback), `validateCategoryName`
  - `search.ts`: `normaliseForSearch` (case, spacing, brackets, Urdu diacritics, Arabic/Urdu letter forms), `matchesSearch`, `searchItems` (prefix matches first)
  - `presets/freshProduce.ts`: 83 presets (34 / 9 / 40) with key, category, group, en, ur, Roman spellings (**every list marked `// verify: Junaid`**), unit, FOC default, seasonal; `PRESET_CATEGORIES` (three categories with Urdu names); `presetsForPicker()` order
  - schemas and `SYNC_TABLES` entries for the five tables; `ACTIONS.manage_products` (owner)
- `apps/pos`:
  - Dexie **version 5**: `categories`, `products`, `product_costs`, `price_history`, `product_cost_history`
  - `features/catalogue/catalogueRepo.ts`: every write through `localWriteMany` with the acting owner; `saveProduct` (price history only when the sale price changes; cost + cost history only on owner devices and only when it changes), `setSalePrice` (quick edit), `setProductHidden`, `saveCategory`, `moveCategory` (renumbers 1…n), `createFromPresets` (one transaction: categories on demand matched by English name, products with `search_terms`, history for given rates, skips active duplicates, **restores hidden matches with the new rate**), `saveTodaysRates` (one transaction)
  - screens behind `OwnerPinGate` (`/products` layout): product grid (3 columns on phones, English + Urdu name, "Rs 160/kg", search, `CategoryTabs`, show hidden, quick price edit), product form, categories (rename in both languages, ↑/↓), preset picker (grouped, searchable, "Added" / "Hidden", FOC hint, optional rate per item), today's rates (Save all)
  - `CategoryTabs` (reusable chip row for the sale screen)
  - cost fields only on owner devices; elsewhere "Cost prices are set on an owner device (the owner's own phone)."
  - onboarding: fruit & veg shops continue to the picker ("Skip for now"); the next screen is stored in `meta.after_setup` with the device and Home forwards once, so the setup gate's own redirect cannot win the race
  - Settings: Products link for `can(role, 'manage_products')`
  - en + ur strings (units, products, categories, presets, rates); Urdu category names from the spec
- Also included: the header home link (`nav.home`) that was already in the working tree.

**Tests**: DB 85 (+10: shop A/B isolation, cashier reads products and sale history but never costs or cost history, cashier cannot write products / categories / prices, history append-only, category from another shop refused, unit / price / search term checks, shop device never pulls costs or cost history while owner devices do, `product_costs` push refused from a shop device and from a cashier actor and accepted from an owner on an owner device, product + first price row pushed twice without duplicates, cashier actor product edit refused). Core 200 (+29: search incl. "aalu", "آلو" (alef madda, lam, waw, checked by code point), "potato", "chaunsa", letter folding; preset counts and integrity; form validation; helpers). Pos 141 (+22: product writes and history rules, cost only when asked, hide/restore, form validation, owner-device form, shop-device form without cost, Products hidden from cashiers, quick price edit, category tabs and Roman search, categories create/rename/reorder incl. buttons, presets one transaction / categories on demand / rate vs blank / no duplicates / hidden restored / picker badges and restore, today's rates one transaction + screen + no cost column on a shop device, onboarding to the picker for fruit & veg only).

**Decisions**
- `price_history` keeps sale prices only; costs go to the owner-only `product_cost_history` (2a).
- `products.search_terms text[]` for Roman Urdu and other names (2b).
- `manage_products` is owner-only; whether cashiers may set a rate at the first sale is decided with US029 (3).
- No cost fields on shop devices (4). **A shop whose only device is a shop device cannot record costs until the owner registers an owner device.**
- Category reorder uses up/down buttons; preset categories are matched by English name (5).
- Hiding = `deleted_at`; the picker shows "Hidden" for a hidden match and restores it when ticked (6).
- A blank preset rate gives price 0 and no history row; a typed rate (even 0) writes one.

**Follow-ups**
- Junaid to verify the Roman Urdu spellings (and the Urdu names, per the spec).
- US029: rate prompt for 0-price products at the first sale, and who may enter it.
- Leaving owner mode must also clear `product_costs` and `product_cost_history` (`OWNER_DEVICE_TABLES`).
- Owner-only data on a shop device "fetched online" (architecture §4) is still not built.
- Barcode, FOC rule, minimum quantity and combo editing: later stories (columns exist with safe defaults).
- Product images and grocery/meat presets are out of scope.

## Step 8 — change device mode (2026-11-21)

Owners switch a registered device between owner phone and shop counter from Settings. Closes the Step 5 follow-up (clearing owner-only stores when leaving owner mode).

**Built**
- Migration `20261121120000_device_mode.sql`: `set_device_mode(device_id, mode)`, security definer, owner of the device's shop only (unknown and foreign devices both 42501), a retry with the same mode changes nothing, otherwise updates `mode` (bumping `server_seq`) and writes `device.mode` to `audit_log` with `{from, to}`.
- `packages/core`: `SetDeviceModeRequest` (`owner` | `shop`), client `setDeviceMode(deviceId, mode)`.
- `apps/api`: `POST /devices/{id}/mode`: `can(role, 'manage_devices')` on the caller's role in the device's shop, then `set_device_mode`; 200 / 400 / 401 / 403.
- `apps/pos`:
  - `features/devices/deviceMode.ts` `changeDeviceMode()`: refuses with a non-empty outbox; server first (nothing local changes if it fails); then one Dexie transaction: device row + `meta.device.mode`, owner-only stores emptied on owner → shop, pull cursor back to 0; then Sync now
  - `DeviceModePage` at `/settings/device` behind `OwnerPinGate`: current mode, the same "Who uses this device?" choice as setup, "Sync first" with Sync now while changes wait; Settings link for `can(role, 'manage_devices')`
  - en + ur strings (`deviceMode.*`, `TODO-ur`)

**Tests**: DB 90 (+5: owner switches both ways with a `server_seq` bump, audit row with from/to, same-mode retry is a no-op, cashier / other owner / unknown device / no user refused, unknown mode refused). API DB 28 (+2: owner both ways and retry, another user's and an unknown device 403). API unit 37 (+2: 401, invalid mode and id 400). Pos 149 (+8: shop → owner resets the cursor and updates meta and the device row, owner → shop empties staff_salaries / product_costs / product_cost_history and keeps the rest, refused with a pending outbox without calling the server, nothing changes when the server fails, link for owners only, owner PIN on a shop device then switch, "Sync first" with Sync now).

**Decisions**
- A new SQL function and route instead of widening `register_device`, so registration stays idempotent and the mode change is audited on its own.
- Server first, then local: a failed or offline call leaves the device exactly as it was.
- Rider mode is not offered here (rider devices come with the rider stories).

**Follow-ups**
- After owner → shop on the same screen, the owner gate asks for the PIN again (the device is now a shop device); that is intended.

## Step 8 fix — re-pull when the app learns new tables (2026-11-21)

**Bug:** rows of tables an app version does not know are skipped in `applyServerRows`, but the pull cursor still moves past them. After an update that adds a table (`staff_pins` in Step 6), a device never received those rows: device A2 had no `staff_pins` row, so `OwnerPinGate` said "Nobody can switch in yet".

**Fix:** `reconcileCursorTables()` (`apps/pos/src/sync/state.ts`) runs at the start of every pull. The cursor is stored with the sync table names it was built with (`meta.sync_cursor_tables`); when `SYNC_TABLES` contains a table not in that set, or the set is missing while the cursor is above 0 (devices from before this fix, reset once), the cursor goes back to 0 and the new set is saved. Architecture §4 Pull updated.

**Tests**: pos 153 (+4: reset and `since_seq` 0 when a table is new, rows of the new table arrive, no reset when the set is unchanged, one reset for a cursor without a saved set, pending outbox edit not overwritten during the re-pull).

**Note:** a full re-pull reads every row of the shop once; fine at today's sizes. If shops grow large, a per-table cursor could replace it (ask first: it changes the pull contract).

## Step 9 — owner PIN reset by email code (2026-11-21)

An owner who forgot their PIN gets a new one with an emailed code: "Forgot PIN?" on the owner keypad, online only.

**Built**
- Migration `20261121150000_owner_pin_reset.sql`: `owner_pin_target()` (internal: active, not deleted owner row with `membership_user_id = current_user_id()` in a shop the caller owns, else 42501), `request_pin_reset_code()` (60 s cooldown and 10 per 24 h per user from `audit_log` `pin.code_sent`, advisory lock against races, records the send), `reset_owner_pin()` (upsert `staff_pins`, `server_seq` bumps, `audit_log` `pin.reset` with `{ staff_id }` only).
- **No backfill needed:** `create_shop` has set `membership_user_id` on the owner's staff row since the first migration (foundation, onboarding and staff_pins versions); a test proves it. Owners added on the Staff screen have no account and cannot reset by email.
- `apps/api`:
  - `auth.ts`: `sendPinResetCode(email)` (email-OTP type `email-verification`) and `verifyPinResetCode(email, code)` (`verifyEmailOTP`: uses the code up, 3 wrong tries, 5 minutes, creates no session); `otpEmail()` words these mails "PIN reset code"
  - `routes/pins.ts`: `POST /staff/{id}/pin-code` (route check with `can(role, 'manage_staff')` and the linked owner row, then the SQL limits, then the email inside the transaction so a failed send is not counted; 200 / 403 / 429 `code_cooldown` / 429 `code_daily_cap`) and `POST /staff/{id}/pin` (eligibility checked before the code so others can't burn it; 400 `invalid_code` / `code_expired`, 429 `too_many_attempts`, 403)
- `packages/core`: `ResetOwnerPinRequest`, `PinResetCodeResponse`, error codes, client `sendPinResetCode` / `resetOwnerPin`.
- `apps/pos`: `features/pin/forgotPin.ts` (eligibility, reset, `storeResetPin`: `staff_pins` row + `meta.pin_lock` cleared + current staff in one transaction) and `ForgotPinFlow` (email → code + new PIN + confirm, Resend, offline message, server messages); `StaffPinPicker` shows "Forgot PIN?" for the linked owner on the keypad and also when the device has no PIN for anyone yet. en + ur strings (`forgotPin.*`).

**Tests**: DB 97 (+7: own reset with `server_seq` bump and audit without secrets, pulled by the shop device, cashier / rider / other shop's owner / unlinked owner row / inactive owner / no user refused, malformed hash, cooldown, daily cap incl. 24 h window, send rows without payload). API DB 36 (+8: owner link from `create_shop`, full flow with the captured "email-verification" code and audit without code or hash, reused code, wrong code then too many tries, expired code, cooldown and daily cap, refusals without any email sent, 401 / 400). API unit 38 (+1: email wording). Pos 163 (+10: link for the linked owner only, not for cashiers or unlinked owners, offline message, full flow with lock cleared, owner switched in, no outbox entry and the new PIN working offline, server error messages, both limit messages, link when no PIN is on the device).

**Decisions**
- Email-verification OTP checked server-side with `verifyEmailOTP` (no extra session), mails say "PIN reset code" (decision 1).
- Two routes, always the session's email (decision 2).
- 60 s cooldown and 10 per 24 h from `audit_log`, no schema change (decision 3).
- "Forgot PIN?" is also shown when no PIN is on the device for anyone, so a device like A2 in the Step 8 fix can recover.

**Follow-ups**
- SMTP provider (§8): until then codes reach the console in development only; in production sending fails with 500 and nothing is counted.
- A second owner on a shop device can only reset their PIN after signing in with their own account there.

## Step 10 — US078 product icons (emoji) (2026-11-21)

Every product can show one emoji picture on its tile, so the counter finds items at a glance. Offline, no uploads.

**Built**
- Migration `20261121180000_product_icon.sql`: `products.icon text null` checked by `product_icon_ok()` (1–16 characters counted as code points, only emoji blocks U+2190–U+2BFF and U+1F000–U+1FAFF plus variation selectors, zero-width joiner and keycap; no letters, digits, spaces or Urdu text); `icon` added to the products `push_columns`; EXECUTE granted to `naqdpos_app` (the check runs as the inserting role).
- `packages/core`: `isProductIcon()` (same rule, checked per code point), `PRODUCT_ICON_CHOICES` (46 food emoji), `ProductRow.icon` and the row schema field optional so older payloads still validate, `validateProductForm` takes the picture; `freshProduce.ts` `PRESET_ICONS` (one entry per preset, every line `// verify: Junaid`; null where nothing fits, e.g. turnip, taro root, gourds, okra, red/yellow capsicum, guava, pomegranate, falsa, jamun, loquat).
- `apps/pos`: Dexie **version 6** (no store change; keeps the version in step with the schema); `createFromPresets` copies the preset icon to new products and, on restore, keeps an existing icon (`existing.icon ?? preset.icon`); `saveProduct` saves the picture; `IconPicker` ("Picture": None + the grid, 44 px buttons, aria-pressed; a picture not in the grid stays selectable); `ProductIcon` (about 32 px, fixed height, decorative) at the top of product tiles and at the start of preset picker and Today's rates rows. en + ur strings.

**Tests**: DB 113 (+16: six valid icons incl. a variation selector, a newer emoji and a joiner sequence, null, seven refusals incl. English, Urdu, digits, mixed text, a space, empty and 17 characters; icon pushed and pulled; an older payload without icon keeps the stored one). Core 204 (+4: icon rule, picker choices, every preset covered and valid with null where nothing fits, form picture). Pos 170 (+7: preset → product icon and null, restore keeps / fills in, picture set on a new product, cleared with None, grid tiles with and without an icon at the same height, preset picker and Today's rates rows).

**Decisions**
- "16 characters" counts code points on both sides (Postgres `char_length`, JS `[...s].length`).
- Restoring a hidden preset product keeps the owner's picture; only a missing one is filled from the preset.
- Rows (preset picker, Today's rates) show the icon at the start of the row; tiles show it on top.

**Follow-ups**
- Junaid to verify the preset icons (and which "null" items deserve a picture).
- The sale screen (US029) uses `ProductIcon` on its tiles.
- Owner photos: US079 (R2), shown instead of the emoji when present.

## Step 11 — US029 sale screen + cart, US030 custom item (2026-11-21)

Anyone switched in can build a cart offline: search or tap products, enter a quantity (quick buttons, keypad, or "By amount" for kg / litre), set a rate for products that have none, add custom items. Payment (sales, sale_lines, payments) is the next story; Charge is disabled with "Payment comes next".

**Built**
- `packages/core/src/cart.ts`: `CartLine` (snapshots: name, Urdu name, unit, icon, unit price; `is_custom`, `by_amount`), `makeLine()` (total = `priceForQty`, half away from zero to whole paisa), `makeAmountLine()` (**the typed amount is the line total**; qty = amount ÷ rate rounded half up to 5 g / 5 ml in BigInt; refused at rate 0), `qtyForAmount()`, `cartTotals()` (item count, subtotal, total = subtotal until discounts), `UNIT_RULES` (decimals, by-amount, quick buttons per unit), `parseQtyInput()` (per-unit decimals, > 0, at most 9,999 units per line; `g` in whole grams), `qtyLabel()` (g / ml below 1 kg / 1 litre, "½ dozen").
- `apps/pos`:
  - `features/sale/cartStore.ts`: Zustand store with lines, persisted to Dexie `meta.cart_current` on every change (serialised writes; never synced), loaded at start; `itemCount` for the update banners is now derived from the lines
  - `SalePage` at `/sale` (no owner gate; "New sale" button on Home): header (back, "New sale", "Ali · A1", Customer chip disabled until khata), search with core search ("/" focuses it), `CategoryTabs`, product grid (3 columns on phones, up to 6 wider) with icon, both names and "Rs 160/kg"; a product in the cart has the 2 px primary border and a qty badge; tiles are disabled while nobody valid is switched in (the header asks "Who is working?")
  - `QuantityPanel`: quick buttons per unit (kg 250 g…1.5 kg, litre 250 ml…, dozen ½–3, piece 1/2/6/12, bundle 1/2/3/5), keypad (decimal key only where the unit allows), "By amount" for kg / litre with "≈ 315 g for Rs 50", live "1.5 kg × Rs 160 = Rs 240", edit (the first key replaces the old value) and remove; for a 0-price product a "Rate for this sale" step first, with "Also save as today's rate" (owner on an owner device, or the owner PIN via `OwnerPinDialog`; then `setSalePrice`: product + `price_history` through the outbox with the owner as actor)
  - `CustomItemDialog` (name, price per unit, qty, unit default piece; `product_id` null, shown as "Custom"), `CartSheet` (lines, edit, remove, "Clear cart" with confirm), `CartBar` (fixed, primary: item count, total, disabled Charge)
  - shared `ui/Sheet`, `NumberPad` (always `dir="ltr"`), `useOwnerHere()` (the owner who may act without a PIN), `saleFormat` helpers
  - en + ur strings (`sale.*`, `unit.ml`, `home.newSale`)

**Tests**: core 220 (+16: quantity lines for kg / dozen / piece, half-paisa rounding incl. 1.3 kg × Rs 165 = Rs 214.50, by-amount Rs 50 at Rs 160/kg → 315 g with total exactly Rs 50, 5 g half-up edges, rate 0 refused, large values exact, keypad rules per unit, quick buttons, totals, labels). Pos 186 (+16: Home → sale, search in English / Urdu / Roman Urdu and "/", quick-button add with border, badge and cart bar, edit with keypad decimals and remove, quick buttons and keypad per unit, by amount, line-only rate with no outbox write, save as today's rate with the owner PIN from a cashier on a shop device (owner as actor), by amount refused without a rate, custom item and its form checks, cart survives a reload and is not synced, clear cart confirm, fully offline with no API call, "Who is working?" with disabled tiles, Urdu RTL with an LTR keypad). Update banners hidden while the cart has items: SyncPage tests, now with real cart lines.

**Decisions**
- Rate for a 0-price product: anyone switched in may set it for the line; saving it as today's rate is owner-only (`manage_products`, owner PIN). This settles the Step 7 question.
- "By amount" is kg / litre only; the typed amount **is** the line total; `unit_price_paisa` stays the product rate and the line is marked `by_amount` (qty × rate may differ from the total by a few paisa).
- One cart line per product (tapping again edits it); custom items are always separate lines; lines keep snapshots, so a pulled rate change does not alter a cart in progress.
- Quantities over 9,999 units per line are refused (catches "15000" typed for 1.5).

**Notes and follow-ups**
- **Bill totals can still have paisa** (e.g. 1.3 kg × Rs 165 = Rs 214.50). Rounding the bill to whole rupees is decided with the payment story.
- The payment story must store `by_amount` on `sale_lines` (not in architecture §3 yet: ask before the migration), and decide whether `sale_lines` keeps the Urdu name snapshot (§8 open question).
- Discounts and FOC (US032, US033) add fields to the line and to `cartTotals()`.
- The floating nav bar and the Home hero card are still to come.

## Step 12 — US034 cash and complete sale, US035 wallets / bank / split, payment methods (2026-11-21)

A cart becomes a sale offline: the bill is rounded to the whole rupee, paid in cash (with change), wallets, bank or a split, and written in one Dexie transaction with a receipt number from the device. Owners manage payment methods; Today's sales lists sales (owners all, cashiers their own).

**Built**
- **Monotonic `uuidv7()`** (RFC 9562 counter in `rand_a`): ids made in the same millisecond, or when the clock steps back, still increase, so the outbox pushes in creation order. Before this, a child row (a sale line, a first price row) could be pushed before its parent within the same millisecond.
- Migration `20261121210000_sales.sql`: `payment_methods` (sort, cash always active, seeded for every shop and by `create_shop` via `seed_payment_methods()`), `sales` (`rounding_paisa` between −50 and +50, total check, unique `(shop_id, receipt_no)`), `sale_lines` (`shop_id`, `name_ur_snapshot`, `by_amount`), `payments` (amount > 0, sale id required for kind `sale`); composite FKs (line → sale, payment → sale, staff, method → `payment_methods(shop_id, code)`, product). RLS: owners and cashiers read and insert the ledgers, no update or delete; payment methods members read, owners write. Registry: ledgers append-only, `pull_scope all`, `write_roles {owner, cashier}`; payment methods `{owner}`. `sync_push`: a foreign-key violation returns **`missing_parent`**.
- `packages/core`: `sale.ts` (`roundBill`, `changeDue`, `applyPayment` (cash may exceed what is due, the row records the applied amount; other methods may not), `remainingDue`, `businessDate` (Asia/Karachi), `receiptNo` / `receiptCounter`, `buildSale` (at least one line, payments add up exactly to the rounded total)); ledger and payment method row schemas and `SYNC_TABLES` entries; `missing_parent` error code; `ACTIONS.manage_payment_methods` (owner).
- `apps/pos`:
  - Dexie **version 7** (`payment_methods`, `sales` with `receipt_no` and `business_date` indexes, `sale_lines`, `payments`)
  - engine: `missing_parent` entries stay in the outbox (attempts counted) and are retried; after 24 hours they move to `sync_errors`; `onSynced(pushed, recovered)` for "Synced N records" after an outage
  - `completeSale()`: one `rw` transaction over sales, sale_lines, payments, outbox and meta: receipt counter = max(stored counter, highest receipt of this device code in local sales) + 1, rows from `buildSale`, `localWriteMany` with the current staff as actor and `staff_id`, counter and cleared cart saved; waits for queued cart writes first; refuses with nobody valid switched in. `reconcileReceiptCounter()` runs at start
  - `PayPage` (`/sale/pay`, from Charge or F2): rounded total with the rounding line, method chips (active methods; Cash even before methods are pulled), cash with quick Rs 100 / 500 / 1000 / 5000 and Exact, change, split payments with remaining and optional reference, "Complete sale" when the last payment covers the rest
  - `SaleDonePage` (`/sale/done/:id`): receipt number, items, rounding, total, methods, change; "Saved offline — will sync when online"; New sale; Receipt (disabled until US036); the §7 reminder toast at most once per 30 minutes (`meta.sync_reminder_shown_at`)
  - `SalesListPage` (`/sales`, Home → Today's sales) and `SaleViewPage` (`/sales/:id`): owners see all of today's sales, cashiers only their own (UI rule, architecture §5)
  - `PaymentMethodsPage` (`/settings/payment-methods`, owner PIN gate): on / off (cash locked on), ↑ / ↓, add a custom method (`custom_<8 hex>`)
  - global toasts (`ui/toastStore`, `Toaster`); "Synced N records" from the engine
  - cart: `hydrate()` no longer counts a line twice when it was added before the stored cart finished loading (found by the tests)
  - en + ur strings (`pay.*`, `done.*`, `sales.*`, `paymentMethods.*`, `payment.method.*`, sync toasts)

**Tests**: DB 129 (+16: cashier pushes sale / line / payment and a retry adds nothing, rounding and snapshots stored, rider refused by session and as actor, closed day refused, receipt numbers unique, line before its sale → `missing_parent` then accepted, sale of a product made in the same batch, unknown method → `missing_parent`, total and rounding checks, append-only for owners too, shop isolation and riders see nothing, line pointing at another shop's sale, push / pull round trip incl. payment methods, methods seeded, owner-only writes, cash cannot be switched off, owner-only method push, `create_shop` seeds four methods). API DB 36. Core 243 (+23: rounding x.50 up / x.49 down / whole / after discount, change, cash vs wallet payments, split remaining, Karachi midnight edges, receipt numbers, `buildSale` rows, order and refusals, monotonic ids within one millisecond and across a clock step back). Pos 207 (+21: one transaction with outbox order sale → lines → payments, nothing written on a failure, short payment refused, counter increments and continues after the counter is lost, cash with change and success screen, Exact, split with reference, wallet overpay refused and disabled methods hidden, offline end to end with no API call, F2, reminder toast once, owner sees all and cashier only own sales, payment methods screen (owner gate, cash locked, switch off via outbox, add custom, reorder), engine: two batches in order, a child before its parent retried then accepted, 24 h → error, synced-after-outage signal).

**Decisions**
- Bill rounded to the nearest whole rupee, half up; `sales.rounding_paisa` signed.
- `sale_lines` stores `name_ur_snapshot` (closes the §8 item) and `by_amount`.
- `payment_methods.sort`; built-in method names through i18n; custom codes `custom_<8 hex>`.
- Riders get no sales; "own sales only" for cashiers is a UI rule (architecture §5).
- Foreign-key violations are retried as `missing_parent` for 24 hours before they show as errors.
- Receipt numbers never repeat: the counter is checked against local sales before every sale and at start.

**Follow-ups**
- Closed days: `is_day_closed()` is still the stub; the client check comes with `day_closes` (US044).
- Server-side check that a sale's lines and payments add up (now only in core before writing).
- `customer_id` FKs come with the customers table (khata).
- Receipt sharing and printing: US036.
- The rider stories decide what riders see of sales.

## Dev: test on a phone over the LAN (2026-11-21)

- `pnpm dev:lan` (`scripts/dev-lan.ts`): starts the API and the POS dev server, prints `https://<Wi-Fi IP>:5173` (virtual adapters such as WSL/Hyper-V skipped) and the phone steps; the firewall command is a comment, never run.
- POS dev server in LAN mode (`NAQDPOS_LAN=1`): all interfaces + self-signed HTTPS (`@vitejs/plugin-basic-ssl`, dev dependency). `/api/*` proxy to `http://localhost:8787` in every dev run; headers pass through; the proxy presents the API's own `Origin` so Better Auth accepts sign-in from a LAN origin.
- `apps/pos/src/api/baseUrl.ts`: on the dev server, an empty or `/api` `VITE_API_URL` means `<origin>/api`; builds use `VITE_API_URL` exactly. Tests: `baseUrl.test.ts` (3).
- CORS unchanged: the phone's calls are same-origin through the proxy, so no LAN origins are added.
- `scripts/tsconfig.json`; root `typecheck` also checks `scripts/`; ESLint Node globals for `scripts/`. README added; `docs/deployment.md` §3.
- Checked by hand: health, the app page, a custom header (`X-Device-Id`) and a sign-in POST with a phone `Origin`, all through `https://…:5173/api`.

## Step 13 — US024 stock on sale, US025 wastage, stock in, stock count (2026-11-22)

Stock is the sum of movements. A sale moves stock for tracked products in its own transaction; the Stock screen records wastage / damaged (owners and cashiers), stock in and counts (owner). Everything offline through the outbox.

**Built**
- Migration `20261122090000_stock.sql`: `stock_movements` (append-only, no cost column, qty ≠ 0, reason check, `ref_id` required for `sale`, composite FKs to the shop's product and staff); RLS owners / cashiers read and insert, riders none, no update / delete; trigger `stock_movements_check()` (sale → its sale must exist, else 23503 = `missing_parent`; purchase / count_correction → owner actor, or owner session for a direct insert); view `product_stock` (`security_invoker`); registry `append`, `pull_scope all`, `write_roles {owner, cashier}`; `sync_push` sets `app.actor_staff_id` per entry and clears it.
- `packages/core`: `stock.ts` (`STOCK_REASONS`, `StockMovementRow`, `stockOf`, `stockByProduct`, `needsStockCheck`, `canRecordStockReason`, `buildSaleMovements` (tracked lines only, custom items never), `buildStockAction` (wastage / damaged negative, stock in positive, set stock = counted − current or nothing, `countNote` "counted 12.5 kg")); `StockMovementRowSchema`; `SYNC_TABLES.stock_movements`; `ACTIONS.record_wastage` (owner, cashier), `ACTIONS.adjust_stock` (owner); shared fixture `fixtures/stock-movements.json`.
- `apps/pos`:
  - Dexie **version 8** (`stock_movements`: shop_id, product_id, business_date, server_seq)
  - `completeSale()`: products and stock_movements join the one transaction; movements after the payments (pushed after their sale)
  - `/stock` (`StockPage`, linked from Products and the product form): tracked products with stock ("12.5 kg"; ≤ 0 amber "check stock"), search, Wastage (Spoiled / Damaged, optional note; owners and cashiers), Stock in and Set stock (owner here, or the owner PIN per action via `OwnerPinDialog`, which now takes a message)
  - `StockActionSheet`: sale keypad rules per unit; set stock shows the difference, runs Sync now first (`syncBeforeCount`, 8 s), else "Other devices' sales may be missing — count anyway?"; `recordStockAction` reads the current stock in the write transaction
  - product list shows stock on tracked products; the product form shows it under "Track stock"
  - `useStockText` adds the sign itself (`qtyLabel` is for positive amounts)
  - en + ur strings (`stock.*`)
- Pay test: the F2 navigation wait is 5 s (it hit the 1 s default when every package's tests ran at once).

**Tests**: DB 140 (+11: cashier wastage / damaged; stock in and count refused for a cashier actor on an owner session, accepted for the owner, count note kept; cashier session direct insert refused; sale movement → `missing_parent` then accepted, missing ref invalid; zero qty / unknown reason invalid; riders refused; closed day refused; append-only, shop isolation and riders see nothing (also in `product_stock`); other shop's product → `missing_parent`; no cost column; `product_stock` matches the shared fixture; push / pull round trip; actor setting cleared). Core 261 (+18: sums and the fixture, check stock, sale movements tracked only / custom none / unknown product none / no cost, actions and signs, set stock difference and note, equal count = nothing, cashier refused, bad qty and long notes). Pos 222 (+12: sale writes movements only for tracked products, after the sale in the outbox; nothing written when the sale fails; negative stock shown amber and the sale goes through; list shows stock for tracked products; cashier damaged with a note offline through the outbox; cashier asked for the owner PIN; cashier actor refused in core; owner stock in; set stock syncs first and counts against the synced stock; offline warning then count anyway; failed sync cancelled; equal count writes nothing).

**Decisions**
- No cost on `stock_movements`; wastage value in owner reports from `product_cost_history`.
- Stock never blocks a sale and can go negative (amber "check stock").
- Stock in (`purchase`, no supplier) and Set stock (`count_correction`) are owner-only until purchases (R2).
- Set stock syncs first; offline it warns and allows the count; the counted quantity is always kept in the note.
- FOC lines will move stock too (the goods leave the shop) when FOC is built.

**Follow-ups**
- Cashiers reach `/stock` only by address until the Home tiles link it (Products is an owner screen).
- Closed days: the client check comes with `day_closes` (US044); the server already refuses.
- Combos (`combo_component`), returns and purchases add their own reasons later.
- Wastage in daily and monthly reports (with value from cost history) comes with the reports stories.
- Stock is summed from every movement on the device; cache it if large shops get slow.

## Step 14 — US032 discounts, US033 free (FOC) items (2026-11-22)

Line and bill discounts (Rs or whole %), free items that still move stock, one-tap "Add free …?" suggestions, and the cashier give-away limit with the owner's PIN above it. Offline, enforced in core.

**Built**
- Migration `20261122120000_discounts_foc.sql`: `shops.cashier_max_discount_pct` (0–100, default 10; column grant, shop push column; every shop touched once so devices pull it); `sales.discount_approved_by_staff_id` (FK to the shop's staff, trigger `sales_check_approver()`: must be an owner; push column); checks `sales_discount_within_subtotal` and `sale_lines_foc_free`; `foc_rule_ok()` check on `products.foc_rule`.
- `packages/core`:
  - `discount.ts`: `pctOfPaisa` (half up), `checkDiscount`, `discountOn` (limited to the base), `lineDiscountPaisa`, `lineNet`, `focValue`, `computeBill` (the order of calculation, with gross, line discounts, FOC value and give-away), `giveAway`, `withinLimit` (owners unlimited; nothing given away always passes), `approvalCovers`, `FocRule`, `suggestedFocRule`, `focSuggestions` (at most 3), `DEFAULT_CASHIER_MAX_DISCOUNT_PCT`
  - `CartLine` gains `is_foc` and `discount` (as typed, so a % follows quantity changes); `normalizeCartLine` for carts stored earlier; `cartTotals` uses line nets
  - `buildSale`: line discount, `is_foc`, net line totals, bill discount, approver; `over_limit` when a cashier is above the limit without a covering approval
  - `FocRuleSchema` (strict); `ShopRow.cashier_max_discount_pct`; `SaleRow.discount_approved_by_staff_id`; product form "Free with purchase" fields; `ACTIONS.manage_discount_limit` (owner)
- `apps/pos`:
  - Dexie **version 9** (no index change; upgrade fills the shop limit)
  - cart store keeps `billDiscount` and `approval` with the cart
  - cart sheet: Discount (Rs / %) and Free per line, discounts as their own lines, FOC dashed green with value, live totals; `DiscountSheet`
  - product panel "Add free"; editing a line keeps its discount and Free flag
  - `FocSuggestions` chips above the cart bar; FOC tiles dashed with a green "FOC" label
  - Charge (button and F2) and the pay screen read the seller and limit from Dexie at that moment (`currentSeller`) and ask for the owner PIN when needed
  - pay screen: bill discount (locked while payments exist, unlocked when they are removed), item discounts, free value, rounding
  - success screen / sale detail: line discounts, FOC lines, bill discount, "Discount approved by"
  - product form "Free with purchase" (on / minimum bill / quantity; turning it on fills Rs 200 and 1 unit or 50 g); preset picker "Give free with purchases?" on focDefault presets (off by default)
  - Settings → Cashier discount limit (owner PIN gate)
  - API: Kysely shop type gains the column
  - en + ur strings (`discount.*`, `foc.*`, `discountLimit.*`)

**Tests**: DB 147 (+7: a discounted sale with a free line and owner approver accepted; free line with a total refused; bill discount above subtotal refused; approver must be an owner of the shop; foc_rule valid / missing / negative / zero / fractional / string / too large / extra key / array; limit 0–100, owner-only by actor and by RLS, default 10; push / pull round trip incl. the shop limit). API DB 36. Core 285 (+24: % to paisa half up and whole % only; discount above its base refused; order of calculation and rounding after discounts; nothing negative; free line 0 with value kept; give-away incl. FOC value with the paid-lines base; limit for cashier / owner / no seller; approval coverage; buildSale rows, consistent subtotal, `over_limit`, no approver within the limit, owner unlimited; suggestions at the threshold, below, already in the cart, line discounts counted, hidden / no rule, at most 3; FocRuleSchema; preset rule; product form rule fields). Pos 236 (+14: live % line discount; discount above the line refused; cashier within the limit without PIN; above: owner PIN, approver stored, more give-away asks again, sale records the owner; completeSale refuses `over_limit`; owner unlimited; limit from the shop setting, owner-only screen; free line total 0 with stock movement; preset toggle sets the rule; suggestion at the threshold adds FOC and the tile turns FOC; no suggestion below / when in the cart; bill discount live, locked by a payment and unlocked; success screen shows discounts, FOC, bill discount, approver; old stored cart loads).

**Decisions**
- Order: line totals → line discounts → bill discount → rounding → total; `sales.discount_paisa` = bill discount only; line totals are net.
- Whole % only (1–100), converted half up in core.
- The limit base is the paid lines' price before discounts; FOC value counts toward the give-away.
- The bill discount is locked while payments exist; removing them unlocks it.
- Approval covers the give-away the owner saw; giving away more asks again.
- focDefault presets get a rule only when the owner ticks "Give free with purchases?" in the preset picker.

**Follow-ups**
- Receipt printing / sharing shows discounts and FOC with US036.
- Discount and FOC value in reports (daily / monthly) with the reports stories.
- A free "by amount" line is valued at qty × rate in the sale detail (its typed amount is not stored).

## Step 15 — US038 customers, US039 sale on khata, US040 receive payment, US041 khata list (2026-11-22)

Customers by mobile (same number = same customer on every device), all or part of a bill on khata, payments received with a WhatsApp receipt, and the khata list with overdue filter and customer ledger. Offline.

**Built**
- Migration `20261122150000_khata.sql`: `customers` (mutable; mobile E.164 check, unique per shop, fixed by trigger `customers_mobile_fixed()`); `khata_entries` (append-only; per-type checks; composite FKs to customer, sale, payment, staff; trigger `khata_entries_check()`: adjustments owner-only); FKs `sales_customer_fk`, `payments_customer_fk`; `payments_khata_receipt_customer` check; view `customer_balances` (security_invoker); RLS owners / cashiers, riders none; registry rows (`write_roles {owner, cashier}`).
- `packages/core`: `uuid5.ts` (`uuidv5` with WebCrypto SHA-1, `customerId(shop, mobile)`); `khata.ts` (`CustomerRow`, `KhataEntryRow`, `khataBalance`, `runningBalance`, `isOverdue`, `lastKhataPayment`, `splitWithKhata`, `creditSaleEntry`, `buildKhataReceipt`, `buildKhataAdjustment`, `rupeesText`, `khataReceiptText` (en / ur), `waLink`, `telLink`); `buildSale` takes the customer and the khata part (payments + khata = total; `khata_needs_customer`) and returns the `credit_sale` entry; sale payments carry the customer; schemas and registry entries; `ACTIONS.use_khata` (owner, cashier), `ACTIONS.adjust_khata` (owner).
- `apps/pos`:
  - Dexie **version 10** (`customers`, `khata_entries`)
  - cart store keeps the attached customer; `completeSale` writes the khata entry in the sale's transaction
  - sale screen customer chip (`CustomerChip`, `CustomerPicker`): search by mobile or name, add (Pakistani mobile via `phone.ts`, name optional), balance shown, remove
  - pay screen: "Khata" option only with a customer (rest or a typed part, its own row, removable; also locks the bill discount)
  - success screen: customer, "On khata", "New balance"
  - `/khata` (Home → Khata): total receivable, highest balance first, overdue filter (days, default 30), search, call / WhatsApp
  - `/khata/:id`: balance, ledger with running balance (sales link to the sale), edit name / address (mobile fixed), Receive payment (amount, method, reference; WhatsApp receipt), owner-only Adjust balance (owner PIN rules, note required)
  - en + ur strings (`customers.*`, `khata.*`, pay / done additions)
- Pay test: the F2 wait is 5 s (Charge reads the seller from Dexie first).

**Tests**: DB 156 (+9: same customer from two devices merges with the newer name and no duplicate; mobile change refused; sale partly on khata and the balance view; credit_sale before its sale → `missing_parent` then accepted, without a sale refused, a sale for an unknown customer waits; receipt payment + entry, khata_receipt without customer and payment entry without payment refused; adjustment refused for a cashier actor and a cashier session, refused without a note, accepted for the owner; closed day refused; append-only, shop isolation and riders see nothing incl. the view, riders cannot push customers; push / pull round trip). Core 307 (+22: UUIDv5 RFC and Python vectors, version / variant, bad namespace; same mobile in any format → same id, per shop and per number; balance and running balance; overdue rules; split with khata; buildSale fully / partly on khata, khata needs a customer, must close the bill; receipt rows; adjustment owner-only and note; receipt text en / ur, grouped rupees; wa.me / tel; customer schema). Pos 247 (+11: same mobile same customer; chip adds a customer offline and shows the balance; non-mobile refused; Khata only with a customer; whole bill on khata with new balance and outbox order; part cash part khata; one transaction on failure; receive payment writes both rows and the WhatsApp link; list order, total, overdue, search, call / WhatsApp; ledger running balance and sale link; adjust asks a cashier for the owner PIN and needs a note).

**Decisions**
- Customer id = UUIDv5(shop_id, E.164 mobile); the one exception to the UUIDv7 rule; mobile fixed after creation.
- Overdue = balance > 0 and no khata payment for N days (default 30); never paid counts from the first entry.
- Khata corrections are owner-only adjustments with a note.
- Khata on a bill is a `credit_sale` entry, not a payments row: payments + khata = total.
- Payments are received with today's business date.

**Follow-ups**
- Credit limit warning (US042) — `credit_limit_paisa` exists, unused.
- Back-dated khata receipts (with closed days).
- Khata receipts in daily closing (expected cash) and reports.
- Returns (`return_credit`) with the returns story.

## Step 16 — US014 shop profile, US036 receipts (WhatsApp, print, Bluetooth) (2026-11-22)

Owners set what receipts show; every sale has a receipt to preview, share on WhatsApp, print in the browser (58 / 80 mm, RawBT on Android) or print directly on a BLE ESC/POS printer as an image (Urdu prints everywhere). Offline.

**Built**
- Migration `20261122180000_shop_profile.sql`: `shops.receipt_language` (en / ur / both), `shops.paper_width_mm` (58 / 80); checks on name, address and footer length; column grants; shop push columns; every shop touched once so devices pull them.
- `packages/core`: `shopProfile.ts` (`validateShopProfile`); `receipt.ts` (`receiptFor` → header, items with qty × rate, line discounts, FOC with value, subtotal, item / bill discounts, rounding, total, payments by method, change, khata part and balance, footer; "both" = "English / اردو"; `receiptText`; `receiptDateTime` in Asia/Karachi); `escpos.ts` (`toMonoRaster`, `escposRaster` in 128-row `GS v 0` bands, `chunkBytes`, `PRINTER_DOTS`); `ShopRow` gains the two columns.
- `apps/pos`:
  - Urdu font `@fontsource/noto-naskh-arabic` 5.3.0 (approved option (a)), Arabic script only, precached (both weights in the service worker)
  - Dexie **version 11** (no index change; upgrade fills the shop defaults)
  - Settings → Shop (`/settings/shop`, owner PIN gate): name, address, phone, footer with a character count, receipt language, paper width; "logo coming soon"
  - `/receipt/:saleId` (from the success screen and from any sale in Today's sales; cashiers only their own): preview at the paper width and language (RTL for Urdu), Share on WhatsApp, Print, Bluetooth printer (where supported) with "Forget printer", Done; the success screen has Receipt and "No receipt"
  - `print/`: `receiptData` (builds the model from Dexie; balance right after the sale for reprints), `ReceiptView`, `share` (customer wa.me → share sheet → clipboard), `bluetooth` (pairing, remembered printer, writable characteristic, chunked writes, clear errors), `canvasReceipt`, `webBluetooth.d.ts`
  - print styles in `index.css` (only the receipt prints; black on white because it is paper)
  - `saleVisibility.ts` (the owner / own-sales rule shared by the sale and receipt pages)
  - API: Kysely shop type gains the columns
  - en + ur strings (`receipt.*` words on paper are full Urdu; screen strings TODO-ur)

**Tests**: DB 159 (+3: defaults; owner saves the profile and every check refuses bad values; push / pull of the new columns; cashier actor refused, cashier session updates nothing). Core 317 (+10: receipt with every section in order; rounding and change without customer / footer / subtotal; Urdu labels, names and money with RTL; both languages; Karachi date; shop profile cleaning and errors; raster of a known 9 × 2 bitmap to the expected bytes incl. transparent and light pixels; bands; chunking). Pos 259 (+12: shop profile owner-only, saves through the outbox, long footer refused; Urdu preview RTL at 80 mm; WhatsApp to the customer offline with khata lines; clipboard fallback with toast; Receipt / No receipt; reprint from Today's sales; another person's receipt hidden from a cashier; Bluetooth hidden without Web Bluetooth; share fallbacks; Bluetooth chunks and remembered printer with a fake printer; Bluetooth off and printer not found).

**Decisions**
- Logo upload deferred to the deploy step (object storage); `<BrandMark />` unchanged.
- Printing: browser print (58 / 80 mm, RawBT) for everything the OS knows and classic Bluetooth; Web Bluetooth for BLE ESC/POS, sent as a raster image so Urdu prints without printer fonts.
- Urdu font: Noto Naskh Arabic, precached.
- Receipts use the shop's receipt language, not the app language.

**Follow-ups**
- Logo upload (pre-signed URL, `logos/<shop_id>/…`) and on the receipt.
- Drawing on a canvas is not covered by tests (jsdom has no canvas); try it on a real BLE printer (58 and 80 mm) before release.
- Cash drawer kick and paper cut commands if printers need them.

## Step 17 — US065 expense categories, US046 record an expense, US066 reverse an expense (2026-11-22)

Expense categories per shop type, expenses offline with the cashier limit and owner PIN, today's list (owners all, cashiers their own), and owner reversals that keep history.

**Built**
- Migration `20261122210000_expenses.sql`: `expense_categories` (mutable, owner writes, `name_ur` approved; `seed_expense_categories()` for every shop and in `create_shop`, no Wastage); `expenses` (append-only; sign check; composite FKs to category, payment method, staff, approver, payee staff and the original; trigger `expenses_check()`); RLS owners / cashiers, riders none; registry rows. `shops.cashier_expense_limit_paisa` already existed.
- `packages/core`: `expenses.ts` (`ExpenseCategoryRow`, `ExpenseRow`, `EXPENSE_CATEGORY_DEFAULTS` / `defaultExpenseCategories`, `needsOwnerApproval`, `canAddExpense`, `canReverse`, `isDayClosed`, `buildExpense`, `buildReversal`, `expenseTotals` by category and method with reversals netted); schemas and registry; `ACTIONS.add_expense` (owner, cashier), `ACTIONS.manage_expenses` (owner); shop profile gains the cashier expense limit.
- `apps/pos`:
  - Dexie **version 12** (`expense_categories`, `expenses` with a `reverses_expense_id` index)
  - Settings → Expense categories (owner PIN gate): add (en + ur), rename (clears the default's key), ↑ / ↓, archive / restore
  - Home → Expense: `/expenses` (today's total and list; owners all, cashiers own; Reversed / Reversal marks), `/expenses/new` (category, amount, method, note, payee; owner PIN above the limit; "Saved offline" note), `/expenses/:id` (details, approver, original link; owner Reverse with a required reason)
  - Settings → Shop: cashier expense limit (Rs)
  - en + ur strings (default category names in Urdu; screens TODO-ur)

**Tests**: DB 168 (+9: seeds per shop type with no Wastage; `create_shop` seeds; categories owner-only by actor and by session; cashier expense with and without an owner approver, a non-owner approver refused; zero amount refused, unknown method `missing_parent`, riders refused and see nothing; closed day refused; reversal refused for a cashier actor, wrong amount refused, once only (unique), a reversal of a reversal refused, no reason refused; original from another shop not found; append-only, isolation, push / pull). API DB 36. Core 330 (+7: defaults; approval rule; build with / without approval; riders, zero, closed day; reversal amount, reason, date today; owner only, once only, never a reversal; totals netted by category and method in a date range; shop profile limit). Pos 269 (+10: archived hidden for new but shown on old; categories owner-only; add / rename / reorder / archive / restore with the owner as actor; cashier within the limit offline with the note and no API call; above the limit owner PIN and approver; riders cannot add; cashier sees own and today only, owner all; reverse with reason, Reversed shown, no second reverse; cashiers get no Reverse; limit setting).

**Decisions**
- No Wastage expense category (stock movements + cost history instead).
- `expense_categories.name_ur` added for owner-typed Urdu names.
- Defaults seeded on the server with i18n keys; renaming clears the key.
- Expenses use `pull_scope all` until `day_closes` adds "open dates only" for shop devices.
- "Not cash" expenses are not a method; expenses use the shop's payment methods.

**Follow-ups**
- Closed-day check on the device and the shop-device pull filter: with `day_closes` (US044).
- Expenses in closing (US067), expense report (US068), bill photos (US069, `expense_attachments`), recurring expenses and `payee_staff_id` (Release 2).

## Step 18 — US044 daily closing, US045 daily summary, US067 expenses in closing (2026-11-23)

The owner closes the day against a cash count; later rows are accepted and flagged; selling after closing rolls to the next day; a daily summary to share or print.

**Built**
- Migration `20261123090000_day_closes.sql`: `day_closes` (append-only, unique per date, `seen_through_seq`, difference check, owner-only trigger `day_closes_check()`, no future dates); RLS owners / cashiers read, owners insert, riders none; real `is_day_closed()`; `shop_expected_cash()`; `sync_push` without the `day_closed` rejection (late rows accepted); registry row.
- `packages/core`: `closing.ts` (`DayCloseRow`, `expectedCash`, `openingDefault`, `closableDays`, `DENOMINATIONS` / `denominationTotal`, `buildDayClose`, `rowsNotSeenAtClosing`, `dailySummary` → receipt lines); `businessDateFor` / `nextDate` in `sale.ts`; every builder (sale, stock, khata, expense) takes `closedDates` and rolls forward (`buildExpense` no longer blocks); schema, registry, `ACTIONS.close_day` (owner); shared fixture `fixtures/expected-cash.json`.
- `apps/pos`:
  - Dexie **version 13** (`day_closes`); `closedDates.ts` feeds every write; `DayClosedBanner` on Home and the sale screen
  - `/closing` (Home → Close day, owner PIN gate): sync first (8 s), offline warning recorded in the note, oldest unclosed day first, opening default, cash sales, cash khata received, cash expenses by category, owner withdrawal, expected cash, count by total or notes and coins, short / over / exact colours, confirm, write through the outbox with the pull cursor as `seen_through_seq`
  - `/closing/:date` summary (WhatsApp text / copy, browser print through the receipt path) with the "Not included at closing" alert; `/closing/history`
  - wastage value from `product_cost_history` only on owner devices (`costsAt`)
  - `printReceipt` moved to `print/printReceipt.ts` (shared by receipts and summaries)
  - F2 on the sale screen uses a layout effect (it missed a key press right after the screen appeared)
  - en + ur strings (`closing.*`, `summary.*`)
- DB tests for closed days now assert that late rows are accepted.

**Tests**: DB 173 (+5 new, 5 changed: owner closes, `is_day_closed` true, one close per date; cashier actor / cashier session refused, future day refused, difference check; a late row from another device accepted and found by the seen-through rule; `shop_expected_cash` = shared fixture; append-only, riders none, push / pull). Core 345 (+12: expected cash = fixture; opening default; 21:30 sale after a 21:00 close → next day; oldest unclosed first, never future; denominations; owner-only, once, future, negative refusals; the 8 pm / 9 pm offline close / 10 pm push case flagged; own unsynced pre-close row not flagged and not waiting; waiting states; summary sections incl. FOC, discounts, khata, wastage value with costs only, gap and late rows; waiting text). Pos 277 (+8: closing owner-only; opening default, expected, notes and coins to exact; offline close with the note, summary waiting; oldest day first; sale and expense after the close go to the next day with the banner; 8 pm / 9 pm / 10 pm case on the device with the gap and late rows; wastage value on owner devices only, WhatsApp copy; history).

**Decisions**
- Late rows accepted and flagged with `seen_through_seq` (not rejected); `day_closed` code reserved.
- New rows after closing roll to the next open day; banner shown.
- Opening default = previous counted − withdrawal; one drawer per shop; owner-only closing and summary.
- Expected cash is not re-checked by the server (the device may have been offline); only difference = counted − expected.

**Follow-ups**
- Close corrections (a later feature).
- Refunds, rider handovers and supplier payments enter expected cash when those features exist (already in the formula).
- Reports (US068 and the owner dashboard) can use `shop_expected_cash()` and the not-seen rule.

## Step 19 — US080 khata fixes found in testing (2026-11-23)

"Khata / Udhaar" is always on the pay screen, customers can be added from the Khata screen, and the owner can carry an opening balance over from the paper khata book.

**Built** (no schema change)
- Pay screen: the "Khata / Udhaar" chip is always shown; without a customer it opens the customer picker (search or add), then attaches the customer and applies the khata part. The attached customer shows on the pay screen with a remove button; with no customer there is no khata part (derived, also when the customer is removed on the sale screen).
- `CustomerPicker`: address field; optional "Opening balance (from your paper khata)" (owner here, or the owner PIN); `startAdding` to open on the add form. An existing mobile picks that customer.
- Khata list: "Add customer" (opens the customer's page; an existing mobile opens that customer).
- Customer page: "Opening balance" while the customer has no entries (owner PIN rules); `OpeningBalanceSheet`.
- `khataRepo`: `findOrAddCustomer` takes an address; `recordOpeningBalance` (owner, only without entries, an `adjustment` with the note "Opening balance", positive = the customer owes; business date rolls forward like every row).
- `pin/ownerHereNow.ts`: the owner-here rule read at tap time (the hook could still be loading, which asked for a PIN needlessly).
- en + ur strings.

**Tests**: Pos 282 (+5 net: the chip without a customer opens the picker, adding a customer attaches it and the bill goes on khata offline; removing the customer on the pay screen clears the khata part; Khata → Add customer opens the customer and an existing mobile opens the same one; owner adds with an opening balance (one adjustment with the note, balance and list updated); a cashier is asked for the owner PIN; the customer page's Opening balance only without entries). The old "Khata only with a customer" test was replaced.

**Follow-ups**
- Opening balances where the customer is owed money (advance) are not offered; use Adjust balance.

## Step 20 — Home screen, navigation, install and storage persistence (US001, US002) (2026-11-23)

The approved Home (hero card, stat cards, action tiles, Recent) and the navigation (floating bar on phones, side nav from 768px), the install button and guides, and persistent storage. All from Dexie, offline.

**Built**
- `packages/core`: `home.ts` — `todayTotals` (cash, wallet / bank, on khata; optional one staff member), `sevenDayTrend` (business dates), `receivableTotal` (positive balances; the khata list uses it too), `lowStockCount`, `recentActivity`.
- `apps/pos`:
  - Home: greeting by Karachi time, shop name, device code; hero card with the current **business date** ("Sales for <date>" and the closed-day line after a close), total, invoices, the three-way split, 7-day CSS bar trend (today highlighted, owners only), sync chip; owner stat cards (Khata owed → Khata, Low stock → Stock); tiles by role (Product, Customer → add customer, Stock in / Wastage, Expense); Recent (last 5 sales and khata entries, See all); install card; owner storage notice. Cashiers see their own sales today, no trend or stat cards. Home waits for the current staff member before showing numbers.
  - `features/home/Nav.tsx` + `navItems.ts`: floating near-black bar with the white Sale pill and a More sheet on phones; side nav from 768px (`app/useWide.ts`, `matchMedia`, one layout rendered at a time); hidden in the sale flow; logical order (mirrors in Urdu). The header sync chip is not shown on Home (the hero has it).
  - Sale screen from 768px: the cart beside the grid (`CartSheet inline`) with Charge; the cart bar on narrow screens only.
  - `app/install.ts` (`installState` per platform, the captured `beforeinstallprompt`, `appinstalled`), `InstallCard` (Home, dismissible; Settings, always). The Home card after onboarding is the "offered once" step.
  - `app/storage.ts` (`ensurePersistentStorage` on each start until granted, `meta.storage_persisted`); the 30-minute estimate was already in `useSyncStatus`.
  - `scripts/check-precache.ts` (`pnpm check:precache`) and the manual offline check in deployment §3.
  - Khata list: `?add=1` opens Add customer.
  - en + ur strings (`home.*`, `nav.*`, `install.*`).
- Fix found by the tests: Home queried payments by `shop_id`, which is not a Dexie index (filtered in memory now).

**Tests**: Core 352 (+7: three-way split for the business date, a cashier's own totals, a 21:30 sale after a 21:00 close on the next date; trend days, gaps, today; receivable positive only; low stock rules; recent order and limit). Pos 294 (+12: owner Home with split, trend, stat cards, tiles, Recent; next-date label after a close; Customer tile opens the add form; cashier Home; nav items by role, hidden in the sale flow; phone bar and More sheet; side nav from 768px; install states per platform; install prompt and dismiss, Settings keeps it; persistence asked until granted; owner notice once). Old "Welcome" heading checks now look for the greeting.

**Manual checks to do on devices**
- Layout at 360, 768 and 1280 px (phone, tablet, PC) in English and Urdu.
- Install on Android Chrome, iOS Safari guide, desktop Chrome / Edge; the offline first launch in deployment §3; load time on a mid-range Android.

**Follow-ups**
- Owner dashboard from the server (US048) with the reports prompt; notifications (then the bell).

## Step 21 — Admin portal part 1: sign-in with 2FA, US010 shop list, US011 suspend / reactivate (2026-11-22)

**Built**
- Migration `20261123120000_admin.sql`: `shops.suspended_at`, `shops.city` (approved; owner column grant, shop push column); `admin_session_2fa` (approved; FK to sessions on delete cascade, no grants); `admin_session_ok` (no session / not admin / older than 12 hours / 2FA not set up / not verified / ok), `admin_mark_session_verified` (also removes expired rows); `admin_list_shops` (search on name / phone / owner email, status / type / city filters, devices, last sync, last sale date, sales in 7 days, paging), `admin_get_shop` (profile, devices, staff without PIN data, 50 conflicts, 100 audit entries), `admin_set_shop_status` (reason required, `suspended_at`, audit `shop.suspend` / `shop.reactivate` with the reason); `admin_grant` / `admin_revoke` for the CLI only; `sync_push` refuses ledger rows created after `suspended_at` (`shop_suspended`).
- `packages/core`: `api/admin.ts` (session state, enrol / verify, shop list / detail / status schemas) and client methods; `shop_suspended` sync code; shop `city` / `suspended_at`; city in the shop profile.
- `apps/api`: Better Auth two-factor with `allowPasswordless`; auth service `getSessionInfo`, `enrollTwoFactor`, `verifyTotp` (returns the replacement token after the first code), `verifyBackupCode`; `routes/admin.ts` (`GET /admin/me`, `POST /admin/2fa/enroll`, `POST /admin/2fa/verify`, `GET /admin/shops`, `GET /admin/shops/:id`, `POST /admin/shops/:id/status`) with the session and admin checks.
- `db/scripts/admin.ts`: `pnpm admin:grant` / `admin:revoke`.
- `apps/admin` (English, online, theme tokens from the same `default.css`): sign-in (Google when enabled, email code), 2FA enrolment (QR drawn in the page with `uqr` 0.1.3 — added to apps/admin only, no network call —, key as text, backup codes with "I have saved them"), 2FA prompt (code or backup code), sign-out, token in sessionStorage, 401 → back to sign-in ("Your admin session ended"); shop list (search, status / type / city filters, columns incl. Plan "—", paging); shop detail (profile, devices, staff, conflicts, audit log; suspend / reactivate with a required reason and a confirm step). Test setup (jsdom, Testing Library — same versions as apps/pos).
- `apps/pos`: red "This shop is suspended — contact NaqdPOS support" banner; `completeSale`, khata receipts / adjustments, expenses and stock actions refuse with `shop_suspended` and a clear message; City in Settings → Shop.

**Tests**: DB 180 (+7: admin functions refuse non-admins incl. the shop owner; list search by owner email, type / city filters, paging; detail without PIN data; reason required, audit as admin with the reason, rows after `suspended_at` refused / before accepted, reactivate restores, admins see no tenant rows directly; per-session 2FA states, 12-hour limit, cascade on session delete, only the own session; CLI grant / revoke audit, unknown email, not callable by the app role; owner edits city). API DB 39 (+3: 401 / 403 for no session and a normal owner; enrol → first TOTP code (session replaced, new token) → a new session needs its own code → backup code → shops, suspend / reactivate, 404; sessions older than 12 hours → 401). Core 354 (+2). Pos 298 (+4: banner and blocked sale / khata / expense with data still viewable; the pay screen message; reactivate; city). Admin 6 (sign-in → 2FA prompt with a backup code → shops; enrolment with QR, key, backup codes and the replacement token; "Not an admin"; 401 → sign-in; list columns and filters; suspend needs a reason).

**Decisions**
- Admin 2FA per session in `admin_session_2fa`; 12-hour admin sessions; admin rights only via the CLI.
- Admin access only through security-definer functions; no admin bypass in tenant RLS.
- Suspension keeps all data; ledger rows after `suspended_at` refused; closing still allowed.

**Follow-ups**
- US012 / US013 (next prompt). App version per device is not stored yet (shown later in device lists).
- Owner sessions keep 90 days; admin portal sessions are ended by the 12-hour check (Better Auth's own expiry stays 90 days for the shared config).

## Step 22 — Admin creates shops, invites owners, acts as shop (US012, US013) (2026-11-23)

The admin portal can now onboard a shopkeeper end to end: create the shop, invite the owner by email (sent as a WhatsApp text), and set up products, categories and staff on the shop's behalf. The owner signs in with the invited email, adds their device and sets their own PIN.

**Built**
- Migration `20261123150000_invites_admin_shop.sql` (approved):
  - `uuid_v7()` in plain SQL (same layout as core's `uuidv7()`), for rows the admin functions create.
  - `invites` (architecture §3): RLS on, no privileges for `naqdpos_app`, one pending per (shop, email), 14 days, not synced.
  - `accept_invites()` (verified email only; membership, staff link, accepted, audit `invite.accept`) and `owner_set_first_pin()` (linked owner only, only once, audit `staff.first_pin`).
  - Admin functions, each `admin_assert()` first and audited with `acting_as_admin = true` and the shop_id: `admin_create_shop`, `admin_create_invite` (replaces the pending one), `admin_revoke_invite`, `admin_save_product` / `admin_hide_product` (price and cost history like the shop's writes; an edit keeps `track_stock` and the hidden state), `admin_import_products` (categories on demand, existing names skip or update), `admin_save_category`, `admin_save_staff` (cashiers and riders only; optional cashier PIN "set by admin"), `admin_shop_catalogue` (categories, products with cost, invites with status, staff with phone and `has_pin`).
  - No Dexie bump: no synced table changed; admin-written rows are ordinary rows with `device_id` null.
- `packages/core`:
  - `productImport.ts`: `parseCsv` (quotes, `""`, commas and line breaks in quotes, CRLF), `decodeCsvText` (strips the BOM; refuses U+FFFD and Arabic-script Windows-1252 mojibake, the full 0x80–0x9F set), `previewImport` (per-row errors, duplicates in the file, existing names, missing columns), `presetImportRows`, `inviteMessage`, `whatsAppLink`.
  - `api/admin.ts` schemas (create shop, invites, catalogue, product / category / staff input, import) and client methods; `FirstPinRequest`; `/me` `has_pin`.
- `apps/api`: `routes/adminShop.ts` (`POST /admin/shops`, `GET /admin/shops/{id}/catalogue`, invites, revoke, products, hide, import, categories, staff — on the guarded admin app); `routes/firstPin.ts` (`POST /staff/{id}/first-pin`: 403 not the linked owner, 409 PIN exists); `GET /me` runs `accept_invites()` first and returns `has_pin`.
- `apps/pos`: "Which shop is this device for?" when `/me` shows more than one owned shop (setup and "Add this device"); "Set your PIN" after adding the device when the owner has no PIN (hashed on the device). en strings; ur strings are `TODO-ur` placeholders.
- `apps/admin` (English, theme tokens):
  - Shops → **New shop** (shop name, type, city, address, phone; owner name, Pakistani mobile normalised, email), then the WhatsApp text with Copy and an "Open WhatsApp" `wa.me` button; warns when `VITE_POS_URL` is not set.
  - Shop detail: **Owner invites** card (status, Resend message, Revoke, New invite when none is pending) and **Act as shop**.
  - **Act as shop** (`/shops/:id/act/...`), "Acting as <shop> — every change is saved as you (admin) and audit-logged" banner on every screen: Products (search, add / edit with optional cost, hide / restore), Fresh produce list (existing names shown as "Added", optional rates), CSV import ("CSV UTF-8" hint next to the file picker, preview table, skip / update, "Import N products"), Categories (add, rename, ↑ / ↓ renumbering), Staff (cashier / rider only, optional cashier PIN hashed in the browser, deactivate / reactivate).
  - `Select` and `Notice` UI pieces; `useFailure` (401 → back to sign-in).
- Settings: `VITE_POS_URL` (admin build) in `.env.example` and deployment §2.

**Tests**: Core 363 (+9: CSV parsing, BOM, mis-encoded Urdu incl. every Urdu letter through a real Windows-1252 decoder, preview validation, missing columns, preset rows, WhatsApp text, `wa.me` link). DB 189 (+9: shop + owner row + seeds + invite, audited; accept only by the invited verified email; expired / revoked ignored; one pending per shop and email; an existing owner accepts a second shop; first PIN rules; every admin function refuses owners; admin rows are UUIDv7 with `device_id` null, audited, pulled by the shop device (costs not to a shop counter); an edit keeps `track_stock`; the catalogue shows `has_pin` and never a hash; import skip / update and presets without duplicates; no owner through staff, no rider PIN). API DB 40 (+1: invited owner signs in with the email code → owner with `has_pin: false` → first PIN once → 409; another email sees no shop). Pos 301 (+3: Set your PIN; owner of several shops picks the shop for the new device; a device already set up stays on its shop). Admin 15 (+9: new shop with mobile validation, WhatsApp text and link; invite card resend / revoke / new invite; banner on every act screen; product edit keeps cost and hide; produce list "Added" and import with skip; CSV preview with BOM, row errors, skip → update, nothing written before Import; a non-UTF-8 file refused; category reorder and add; staff without owner role, hashed PIN, deactivate keeps the phone).

**Decisions**
- Invites match the verified sign-in email; no link or token. Owners set their own first PIN; admins never see owner PINs.
- Admin-written rows carry `device_id` null; the audit log shows who wrote them.
- An admin product edit doesn't change `track_stock` (not on the admin form) or un-hide a product; hide / restore is explicit.
- The CSV must be UTF-8 ("CSV UTF-8" in Excel); other encodings are refused rather than guessed.

**Follow-ups**
- Email the invite when an SMTP provider is chosen (architecture §8).
- Urdu strings for the new POS screens (`TODO-ur`).
- ~~An invite for a different email after the owner joined gave owner access without the staff link~~ — fixed below (refused).
- Admins can set but not clear a product's cost price.

### Fix — refuse a new invite once the owner has joined (US012) (2026-11-23)

- Migration `20261123170000_invite_owner_joined.sql`: `admin_create_invite` raises SQLSTATE `NQ001` when the shop's owner staff row has `membership_user_id` set. Pending, expired or revoked invites for an unlinked owner row still allow a new invite.
- API: `NQ001` → 409 `owner_joined` with the message "The owner has already joined this shop. Adding a second owner isn't supported yet." (`OWNER_JOINED_MESSAGE` in core; new code in `API_ERROR_CODES`). The admin portal's invite card shows it.
- Files: the migration, `packages/core/src/api/{admin,schemas}.ts`, `apps/api/src/routes/adminShop.ts`, `apps/admin/src/app/InvitesCard.tsx`, tests in `db/tests/invites-admin-shop.test.ts`, `apps/api/src/invites.db.test.ts`, `apps/admin/src/app/Admin.test.tsx`; architecture §5.
- Tests: DB 190 (+1: pending → expired → revoked each allow a new invite; after the owner accepts, any new invite is refused and nothing is written; a self-registered shop is refused). API DB 41 (+1: over HTTP with a verified admin session, 200 before joining, 409 `owner_joined` with the message after). Admin 16 (+1: the message is shown).
- **Follow-up:** second owners (a shop with two owner logins, each with their own staff row and PIN) — not supported yet; needs a decision on the staff row and permissions.

## Step 23 — Reports: dashboard, monthly P&L, products, staff, expenses (US047, US048, US049, US068) (2026-11-23)

Owner reports computed on the server over every device's data, with an offline copy on owner devices only.

**Built**
- Migration `20261124090000_reports.sql` (functions only, no tables): `report_assert` (owner of the shop, range ≤ 366 days), `report_cost_at`, `report_lines` (net sales with the bill adjustment shared, cost at sale time), `report_grouped`, `report_open_days`, `report_today`, and the four reports `report_summary`, `report_products`, `report_staff`, `report_expenses` (filters; previous period). **`security invoker` plus an explicit owner check**: owners already read every table these use through RLS, so nothing bypasses it, and RLS still limits rows to the caller's shops.
- `packages/core`:
  - `reports.ts`: the same formulas (`costAt`, `lineCost`, `valueLines`, `reportSummary`, `productReport`, `staffReport`, `expenseReport`, `openDays`), `profitAndLoss` (the P&L lines), ranges (`rangePreset` with Monday weeks, `previousPeriod`, `validateRange`, `lastOfMonth`) and CSV (`toCsv` with BOM and CRLF, `productsCsv`, `staffCsv`, `expensesCsv`, `pnlCsv`).
  - Shared fixture `fixtures/report-month.json`: October 2026, two devices, a cost change mid-month, FOC, `by_amount`, a custom item, bill discounts and rounding, khata from September, an expense and its reversal, wastage and unvalued damaged stock, an unclosed day. Core and SQL both match its expected values; it also checks `expenseTotals`, `receivableTotal` and `expectedCash` / `shop_expected_cash`.
  - `api/reports.ts`: query and response schemas; client methods `reportSummary`, `reportProducts`, `reportStaff`, `reportExpenses`.
- `apps/api`: `routes/reports.ts` — `GET /reports/{summary,products,staff,expenses}` (`can(role, 'see_reports')`, 400 for a bad range, 403 otherwise, `format=csv` for products, staff and expenses with `text/csv; charset=utf-8` and a file name).
- `apps/pos`:
  - Reports in the More sheet / side nav (owners). Routes under `/reports` behind `OwnerPinGate`: Dashboard, Monthly, Products, Staff, Expenses.
  - Dashboard (US048): range chips (Today, Yesterday, This week, This month, Last month, Custom), net sales, payments by method, profit on items with a cost price (and their sales), sales without a cost price (lines, products, "Add cost prices to see the full profit" → Today's rates on owner devices, the product list on shop devices), expenses, wastage, khata due, top 5 products, "Today (still open)".
  - Monthly (US047): month picker, the P&L, receivables at month end, the unclosed-days warning, Print (browser print, `report-print`) and CSV.
  - Products / Staff (US049): sortable tables (tap a header, again to reverse), custom items flagged, CSV.
  - Expenses (US068): list with range, category, method and staff filters, total for the filter, CSV; monthly view by category against last month. Cashiers keep the Expenses screen (own entries today).
  - `reportsData.ts`: fetch; on owner devices write the result to Dexie `report_cache` (v14, local only, newest 50) and fall back to it offline or on a network failure ("As of <time> — offline"); shop devices never write it and show "Reports need internet" offline. The cache is emptied on owner → shop mode and on sign-out.
  - en strings; ur drafts marked `TODO-ur`.

**Tests**: Core 383 (+16: the shared fixture for summary, products, staff, expenses, receivables and expected cash; cost at sale time and before the first cost; bill adjustment shares add up per sale; FOC cost and costed + uncosted = net sales; today still open vs unclosed; P&L with and without uncosted sales; range presets, previous period, validation; CSV escaping and the products CSV). DB 199 (+9: the four functions match the fixture; `shop_expected_cash` on fixture days; expense filters and the previous period of a partial range; today still open; September alone; cashier, rider, outsider and another shop's owner refused by every function; range limits, 366 days allowed). API DB 46 (+5: owner summary; products / staff / expenses CSV with BOM bytes, header, content type and file name; filters reach SQL; cashier, rider and another owner 403, no session 401; range 400). Pos 310 (+12: owner dashboard with cards and cache write; offline from the cache with "as of"; network failure falls back; shop device asks for the owner PIN, never writes the cache, needs internet offline; menu; monthly P&L, unclosed days and CSV; plain "Net" and today still open; sortable products and CSV; staff; expense filters and monthly comparison; cache emptied on mode switch and sign-out).

**Decisions**
- No "gross profit at least X": profit only on items with a cost price; sales without a cost price shown apart with a link to add costs; Net "excluding sales without a cost price" when there are any.
- Bill discount and rounding are shared across a sale's lines in proportion to line totals (cumulative rounding), so costed and uncosted sales add up to net sales exactly.
- Earlier days with activity and no close are "unclosed"; today is "Today (still open)".
- Reports stay JSON from the API; the app builds CSV with the same core functions, so exports also work offline on owner devices.

**Also fixed**: three existing khata tests were flaky (they failed about half the time on `main` too): a button or heading found by an earlier render was replaced while the list's live queries settled. They now retry inside `waitFor` (`openAddCustomer()` helper).

**Follow-ups**
- Payables in the monthly report once purchases (E08) exist.
- Urdu strings for the reports screens (`TODO-ur`).
- The expense list shows at most 5,000 lines (the total and count cover all); paging if shops ever reach that.
