# NaqdPOS — bugs & UX notes

## Open

### 2026-11-26 — Staging: GET /sync/pull answers 500 for a fresh device — cause found; staging needs its migrations

A new device (incognito desktop Chrome as owner, the iPhone) gets `500 {"error":"internal"}` from `GET /sync/pull?since_seq=0`, so no products or sales arrive. On the iPhone the setup screen shows "Something went wrong. Please try again.": that text comes from `GET /me` failing during setup (`SetupPage`), so `/me` fails too.

**Checked (not the cause on a database built from `db/migrations`):**
- `sync_units()`, `sync_pull` and `sync_push` are executable by `naqdpos_app`; a db test now pins the grants of every function (only internal security-definer helpers and the admin CLI are excluded).
- A missing grant would answer 403, not 500: the sync routes map SQLSTATE 42501 to `forbidden`.
- A fresh device pulling the whole shop from 0 through the real API as `naqdpos_app` (owner and shop mode, default and small pages; products incl. ml, sales, lines, payments, khata, day closes) gets 200 and every row parses.
- The original desktop calls the same `sync_units()` on each pull, so the new function alone cannot break only fresh devices; its pulls may be failing too without anyone noticing (it shows local data).

**Cause (26 Nov 2026).** The staging database is behind the API: its newest applied migration is `20261124090000`; `20261125090000_ml_unit` and `20261126090000_sync_units_field` were never applied, so `sync_units()` does not exist. The deployed API calls it on every pull, so every pull failed with SQLSTATE 42883 and answered 500 (the original desktop too; it only kept showing local data). The same gap explains the first bug of 25 Nov: without `20261125090000` the `ml` unit check never reached staging, so an `ml` product was rejected as `invalid`. The pre-deploy migration step either did not run for these deploys or ran against another database.

**Code safeguard (commit after `6928ba2`).** When `sync_units()` is missing, `GET /sync/pull` answers like an older server: rows without `units`, and a warning in the log ("the database is behind this API"). The app then sends only the original units and holds `ml` rows on the device (architecture §4 Push 5). Test: hide `sync_units()`, pull → 200 without units (the old code answered 500).

**Pre-deploy cause (27 Nov 2026).** Staging's `api` deployments have no Pre-deploy step (Initialization, Build, Deploy, Network, Post-deploy), so migrations never ran on deploy; the earlier ones were probably applied by hand. `apps/api/railway.json` has the command, so the service is not reading that config file (Config file path). Fix in Railway: Config file path `apps/api/railway.json` (or Pre-deploy command `node /repo/db/scripts/migrate.ts`); check the worker's config path too. Code: `db:deploy` logs each file and fails on any error or leftover pending migration; the API refuses to start when the database is behind it (`public.applied_migrations()`, migration `20261127090000`); CI runs the pre-deploy command inside the built image on an empty Postgres 18 (deployment.md "Migrations").

**Still to do on staging (before 27 Nov):** apply the two migrations (`pnpm db:deploy` with staging's `DATABASE_ADMIN_URL`, or redeploy once the pre-deploy step works) and find why pre-deploy did not apply them: the `api` service's Pre-deploy command and its log, and whether `DATABASE_ADMIN_URL` and `DATABASE_URL` point at the same database (`railway`). `GET /me` failing during setup is not explained by this (it does not call `sync_units()`): its log line is still needed.

**Earlier step:** the API log line of the 500. 500s now carry `request_id` in the body and `X-Request-Id`, and the log line has `requestId` plus the Postgres SQLSTATE / routine / detail (`pg`). Read-only checks on staging in the progress entry of 26 Nov 2026.

## Fixed

### 2026-11-26 — Old sales missing from the Sales screen (not data loss) — fixed 2026-11-26

After the Day Close changes, older sales did not show on the Sales screen on desktop or phone, while khata still showed the credit balance from them.

**Cause.** No data was lost: every sale is in the staging database, and nothing in that day's commits changed how sales are read, stored or pulled (`sync_pull` returns every row of the shop by `server_seq`, no date filter). The Sales screen has only ever listed sales whose `business_date` is today's date (`where('business_date').equals(businessDate())`); there was no way to see earlier days on the device, only in Reports. Separately, the investigation found that a pulled row which fails its schema was skipped silently (`applyServerRows`).

**Fix.**
1. **Sales history** (owners): Today / Yesterday / This week / Custom (up to 31 days), kept in the URL so "Back to sales" returns to the same range; "See older in Reports". Cashiers see only their own sales of the open business day since the last Day Close (US018 "current shift"), no picker. The title names the business date or range; after the calendar day is closed: "Day closed — new sales go to <date>". Reads one `business_date` at a time with a single-field `equals()` (Safari-safe). Range logic in `packages/core/src/salesRange.ts`.
2. **Pulled rows that fail their schema** are kept in `sync_errors` (`op: 'pull'`) and shown on the Sync screen under "Not stored on this device", with the record, table and field; warning, not critical; header chip "Check sync".

### 2026-11-25 — Day Close crashes on iPhone: "Unable to open cursor" — fixed 2026-11-26

Tapping Day Close on iPhone (Safari, the installed PWA, Chrome on iOS, private browsing; also with a brand-new local database after a fresh sign-in) showed React Router's raw error page "UnknownError: Unable to open cursor", every time.

**Cause.** `useActivityDates()` (`features/closing/closingData.ts`) found the "oldest unclosed day with activity" with `table.orderBy('business_date').uniqueKeys()` on sales, payments, expenses, stock movements and khata. Dexie runs that as `IDBIndex.openKeyCursor(null, 'nextunique')`, a unique-direction key cursor on an index, which iOS WebKit refuses with `UnknownError: Unable to open cursor`. It runs first on every Day Close visit, with or without data, so it failed every time and on fresh databases. Nothing else in the app used `uniqueKeys()`; ordinary forward index cursors work on iPhone (the receipt counter's `startsWith().each()` runs on every sale). The error went to React Router, which has no error screen of ours, so the raw page showed. Playwright's WebKit (another IndexedDB backend) runs the query fine, so the e2e test refuses those cursors the way iOS does.

**Fix.**
1. Day Close reads with single-field `equals()` / plain `toArray()` only: activity dates from one `toArray()` per ledger table, deduped in core (`activityDates()`); sale lines with `where('sale_id').equals()` per sale instead of `anyOf()`, kept in the same order (`sortSaleLines()`). Same results on every browser; no schema or Dexie version change.
2. Same clean-up elsewhere: the Sync screen's `anyOf()`, the reports cache's `orderBy('saved_at').limit()` and the khata balances' `each()` now read with `equals()` / `toArray()`.
3. Friendly error screens (en + ur, RTL): every screen inside the layout, Day Close with its own message, and an app-wide one; "Try again" and "Reload app"; never React Router's raw page.
4. Reopen-and-retry (`db/retry.ts`): on `DatabaseClosedError`, "Connection to Indexed Database server lost" or `UnknownError` a read closes and reopens the database once and tries again; a second failure shows "Please reload the app" (the outbox stays on disk). Used by Day Close, reports, khata, expenses and Home.

**Tests.** e2e `day-close.spec.ts` on Chromium and WebKit with iOS cursor limits emulated (unique cursors refused: the iPhone failure, reproduced before the fix; every index cursor refused), plus the friendly screen in en and ur. Unit: Day Close with every index cursor refused in fake-indexeddb (fails on the old code with the iPhone error), friendly screens, retry helper, `activityDates` / `sortSaleLines`.

### 2026-11-26 — New Sale: product tiles right-aligned on mobile — fixed 2026-11-26

On iPhone the product tile content (icon, name, price/unit) was right-aligned; on desktop it was centred.

**Cause.** New Sale had two tile variants. The desktop one (`wide`) was `flex-col items-center text-center`; the phone one was `flex-col … text-start` with no `items-center`, so icon, name and price sat at the start edge: left in English, **right in Urdu (RTL)**. Not iOS Safari's button styling: Chromium at 375px was off-centre the same way (8–34px). On desktop a long name was `truncate`d to one line, so its text ran past the tile (132px off-centre). The Products grid card was `text-start` too.

**Fix.** One `ProductTile` (`apps/pos/src/features/catalogue/ProductTile.tsx`) for New Sale (both widths) and the Products grid: `flex flex-col items-center justify-center text-center w-full h-full` at every width, no breakpoint-only alignment; names `line-clamp-2`, the other-language name 1 line; the icon keeps its 40px when empty; grids use `auto-rows-fr` so every tile has the same height. The Products card's price button is centred too. The preset picker and Today's rates are list rows (checkbox / price inputs), not tiles: they keep their row layout, already with logical classes only.

**Test.** `e2e/tests/product-tiles.spec.ts`: Chromium and WebKit, 375px and 1280px, English and Urdu; seeded products with and without icons, a long name, kg and piece; icon, name and price centred on their tile within 2px, all tiles the same height. Failed on WebKit at 375px before the fix.

### 2026-11-25 — Staging rejects a product change: "The data was not valid" — fixed 2026-11-26

On staging (shop of Mian Sami, device A1) a product using the new `ml` unit was pushed at 25 Nov 18:34 UTC, right after the ml change was deployed. The Sync screen showed "Needs review": `sync.table.products` — "The data was not valid." The change was stuck on the device.

**Cause.** The code at `44812f0` accepts `ml` everywhere (migration `20261125090000_ml_unit.sql`, the API's sync schema, `sync_push`, core types). The rejection came from deploy order: `pos` and `api` are separate Railway services that both rebuild on a `packages/core` change. The static POS goes live within a minute; the API builds, migrates (pre-deploy) and health-checks first, and the old API keeps running until then or if any step fails. The device had the new app (which can create `ml` products) while the **old API** (`unit: z.enum` of six units) or a **not yet migrated database** answered, so the entry was `invalid`. The app never retried `invalid` entries, so it stayed stuck. Which of the two answered is in the entry's stored `message` on the device (`unit: Invalid option…` = old API; `23514 … products_unit_check` = database) and in the staging `api` deployment and pre-deploy log (checked in the Railway dashboard).

**Fix.**
1. **Deploy-order safeguard**: pull returns the units the server accepts (`sync_units()`); products and sale lines with a unit the server does not list stay in the outbox unsent, and go in the same run once a pull lists them. An older API (no `units`) is taken to know only the six original units. Deploy order API → POS written into `docs/deployment.md`.
2. **Migration** `20261126090000_sync_units_field.sql`: re-checks the ml unit constraints idempotently (only acts where `ml` is missing; no lock or rewrite where it is there; `20261125090000` is not edited), adds `sync_units()`, and `sync_push` names the failed column in `field`. The API's own schema check names it too. The error shape only gains an optional key.
3. **Try again** (owner only): per rejected entry and "Try all again"; the entry goes back to the outbox and syncs (offline: waits). Rejected again → back in "Needs review". Cashiers see that the owner must review.
4. **Sync screen**: labels (en + ur) for every synced table, tested; headline "1 change was not accepted" / "3 changes were not accepted" in the warning style, "Everything is synced." only with nothing pending or rejected; each entry shows the record's name, its table and the field ("Unit was not accepted.").
5. **Header at 375px**: the shop name collapsed to nothing or one letter next to the "N" mark. It now keeps a minimum width and ends in an ellipsis; on phones the staff chip is a round initials badge (name in its label), the sync chip keeps its full text; `dir="auto"` so a Latin name in Urdu cuts at its own end. Checked in English and Urdu, Chromium and WebKit.

**To unstick device A1** after this is deployed: open Sync as the owner and tap "Try again" (or "Try all again").

### 2026-11-25 — Change request: add `ml` as a product unit — done 2026-11-25

Products can be sold per millilitre (whole ml like g, price per ml: Rs 50/ml × 6 ml = Rs 300). Migration `20261125090000_ml_unit.sql`; product form, sale screen, receipts, CSV import and admin accept it; a device that doesn't know a unit shows its code instead of dropping or crashing.

### 2026-11-25 — Product import list ignores shop type — fixed 2026-11-25

A `general` shop was offered the fresh fruit & veg import list. The list now comes from `getPresetsForShopType` (`packages/core/src/presets/index.ts`): only `fruit_veg` has one; grocery, meat and general skip the onboarding step, have no "Add from list" (shop app) or "Fresh produce list" tab (admin act-as-shop), and the route says there is no list yet.

### 2026-11-24 — UX improvements (noted 2026-11-24) — fixed 2026-11-25

1. **Fixed header.** The top app header (shop name, user/device chip, sync chip, settings) now stays fixed at the top while the page scrolls; the page pads its top by the header height plus `env(safe-area-inset-top)`.
2. **Tender screen fits on one screen, with no scrolling.** Built for 375×667 (iPhone SE) first: total, tendered, change (or "Remaining"), payment method chips (cash / wallets / Khata), note buttons and the confirm button are all visible at once. Only the split-payment list scrolls when it needs room. From 768px the screen uses two columns.
3. **Tap denominations to add up the tender.** Rs 5000, 1000, 500, 100, 50, 20, 10 and coins 5, 2, 1. Each tap adds its amount, with a count badge ("100 ×2"), plus "Exact" and "Clear". Typing stays available (keypad button on the tendered amount). Logic in `packages/core/src/tender.ts`.
4. **Icons on the bottom nav.** An outline icon above each label (Home, Sales, Sale, Products/Khata, More), raised Sale button; the side nav and More sheet use the same icons.

### 2026-11-24 — Mobile UI (reported on iPhone) — fixed 2026-11-24

1. The bottom nav didn't sit flush with the bottom of the screen; there was an empty gap in the home-indicator area under it.
2. Import products had no "Select all" option.
3. On Import products, the "Add product" button was hidden behind the bottom nav.
