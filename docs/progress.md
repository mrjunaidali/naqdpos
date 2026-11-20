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
