# NaqdPOS architecture

Source of truth for the data model, sync and access rules. AI sessions must follow it and ask before changing it.

## 1. System overview

Own backend on open standards. Every part is configured by environment variables and can move to another host by changing them (see `docs/deployment.md`).

```
 Shop device (PWA)                    API service (apps/api)             PostgreSQL
 ┌──────────────────────────┐        ┌───────────────────────────┐     ┌──────────────────────┐
 │ React UI                 │        │ Node 24 + Hono            │     │ tables, RLS          │
 │   ↕ useLiveQuery         │  HTTPS │ Better Auth (login, 2FA)  │ SQL │ SQL functions:       │
 │ Dexie (IndexedDB)        │ ─────► │ /sync/push, /sync/pull    │ ──► │  sync_push/sync_pull │
 │   data tables + outbox   │ ◄───── │ /reports/*, /admin/*      │     │  reports, closing    │
 │ Sync engine (bg, retry)  │        │ sets app.user_id per tx   │     │ pg-boss job tables   │
 │ Service worker (Workbox) │        └───────────────────────────┘     └──────────────────────┘
 └──────────────────────────┘        Worker (same codebase): jobs,     S3-compatible storage
 Admin portal (online) ──HTTPS──►    WhatsApp, alerts, backups         (Cloudflare R2): photos, logos
```

- The UI only reads from Dexie. The sync engine moves data between Dexie and the API.
- Apps know one setting, `VITE_API_URL`. The API knows `DATABASE_URL`, `S3_*`, `SMTP_*` and auth secrets. Nothing else is hard-wired.
- The API is stateless (sessions live in Postgres), so it can run as many copies as needed behind a load balancer.
- The admin portal uses the same API (`/admin/*` routes), online only.

## 2. Conventions for every synced table

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | UUIDv7, generated on the device |
| `shop_id` | uuid | tenant key, RLS on every table |
| `created_at` | timestamptz | device time at creation |
| `updated_at` | timestamptz | device time of last edit (mutable tables only) |
| `server_seq` | bigint | assigned by server on every insert/update (global sequence); used as pull cursor |
| `deleted_at` | timestamptz null | soft delete (mutable tables only) |
| `device_id` | uuid | which device created it |

Money: `*_paisa bigint`. Quantity: `*_milli bigint` (thousandths of the product's unit).

## 3. Tables

### Tenancy and people
- `shops` — id, name, type (`fruit_veg` | `grocery` | `meat` | `general`), address, phone, receipt_footer, logo_path, status (`active` | `suspended`), plan_id, timezone (default `Asia/Karachi`), cashier_expense_limit_paisa (default 200000 = Rs 2,000), cashier_max_discount_pct (integer 0–100, default 10; owner-only, §5).
- `users`, `sessions`, `accounts`, `verifications`, `two_factors` — login tables owned by Better Auth (created by its migration, kept in our `db/migrations`). `users`: id, email, name, email_verified, image. Not synced to devices.
- `memberships` — user_id (`users`), shop_id, role (`owner` | `cashier` | `rider`). Online logins (owners; riders who sign in on their own phone). See §5.
- `staff` — id, shop_id, name, phone, role (`owner` | `cashier` | `rider`), pin_hash (**always null since 20 Nov 2026**; kept for old apps, not pushable, to be dropped), membership_user_id null, active. Every sale/expense records `staff_id`.
- `staff_pins` — staff_id (pk), shop_id, pin_hash, timestamps. **PIN hashes, separate so rider devices never hold other staff members' hashes** (decided 20 Nov 2026). RLS: owners read and write, cashiers read, riders read only their own row. Pulled and pushed only by owner and shop devices (`pull_scope = counter_device`).
- `staff_salaries` — staff_id (pk), shop_id, monthly_salary_paisa null, updated_at. **Owner-only; a separate table so salaries never sync to shop or rider devices** (same pattern as `product_costs`). Used by US071.
- `devices` — id, shop_id, name, code, registered_by, last_sync_at, last_seq_pulled, mode (`owner` | `shop` | `rider`, default `shop`; decided 20 Nov 2026). The owner picks the mode when registering ("Who uses this device?") and can change it later in Settings → Device mode (`set_device_mode`, `POST /devices/{id}/mode`, owner only, audit-logged). A change needs an empty outbox (sync first); the device then resets its pull cursor to 0, and on owner → shop it empties the owner-only stores (`OWNER_DEVICE_TABLES`). Sync bookkeeping (`last_sync_at`, `last_seq_pulled`) does not bump `server_seq`.
- `sync_tables` — registry of synced tables: table_name, kind (`append` | `mutable`), id_column, shop_column, pushable, push_columns (the only columns a device may set), pull_scope (`all` | `owner_device` | `counter_device` = owner and shop devices), write_roles (null = any; otherwise the acting staff member must have one of these roles, §4). `sync_push`/`sync_pull` touch only registered tables; a new synced table = one row here plus its entry in `packages/core/src/sync/tables.ts`. Not synced.
- `sync_conflicts` — id (server-generated), shop_id, device_id, table_name, row_id, incoming jsonb, incoming_updated_at, server_updated_at, at. Pushed edits that lost to a newer server version (§4). Owners can read; not synced.
- `platform_admins` — user_id.
- `audit_log` — id, shop_id, actor_user_id, acting_as_admin bool, action, entity, entity_id, payload jsonb, at.

### Catalogue (mutable, last-write-wins)
Product and category names are stored in both languages in the same row: `name` (English) and `name_ur` (Urdu, nullable). The UI shows the name for the current language and falls back to the other one if empty. Only English and Urdu are supported (Pakistan only).
- `categories` — id, shop_id, name, name_ur null, sort. Owners write (RLS + `write_roles {owner}`); every device pulls.
- `products` — id, shop_id, category_id, name, name_ur null, unit (`kg` | `g` | `dozen` | `piece` | `bundle` | `litre`), sale_price_paisa, barcode null, track_stock bool, min_qty_milli null, is_combo bool, packaging_cost_paisa, foc_rule jsonb null (`{"min_bill_paisa": n, "qty_milli": n}` exactly, e.g. coriander 1 bundle free from Rs 200; `FocRuleSchema` in core and the SQL check `foc_rule_ok()`; shown as a one-tap suggestion, never added automatically; presets marked `focDefault` get the suggested rule (Rs 200, 1 bundle / 50 g) only when the owner ticks "Give free with purchases?" in the preset picker), search_terms text[] (other names and Roman Urdu spellings such as aloo / aalu, at most 20 terms of 1–40 characters; filled from the preset, editable as "Other names / spellings"; decided 20 Nov 2026). icon text null (one short emoji shown on product tiles: at most 16 characters, only emoji code points, no letters, digits or spaces; filled from the preset, chosen in the "Picture" field; US078, approved 21 Nov 2026; owner photos later with US079). Owners write; every device pulls. Hidden products have `deleted_at` set. Varieties (e.g. small and big green chilli, Sindhri and Chaunsa mango) are separate products. Products can be created from the built-in fresh produce list (`docs/features/produce-presets.md`).
- `product_costs` — product_id, shop_id, cost_price_paisa. **Separate table so it never syncs to cashier-mode devices**: owners only (RLS), `pull_scope = owner_device`, `write_roles {owner}`. A shop device never shows cost fields (it holds no costs and its pushes would be refused); costs are set on an owner device.
- `price_history` (append-only) — id, shop_id, product_id, sale_price_paisa, effective_at. **Sale prices only** (decided 20 Nov 2026): every device pulls it, so it must not carry costs. One row on every sale price change.
- `product_cost_history` (append-only) — id, shop_id, product_id, cost_price_paisa, effective_at. Owners only, `pull_scope = owner_device`. One row on every cost change.
- `combo_items` — combo_product_id, item_product_id, qty_milli.
- `customers` — id, shop_id, mobile (E.164, unique per shop), name, address, credit_limit_paisa null, whatsapp_opt_in bool.
- `payment_methods` — id, shop_id, code (`cash` | `jazzcash` | `easypaisa` | `bank` | `custom_<8 hex>`, unique per shop), label, active, sort (decided 21 Nov 2026, for reordering). Seeded for every shop (and by `create_shop`); built-in codes are named through i18n, custom ones by their label. Cash is always active. Owners write (`write_roles {owner}`); every device pulls.
- `expense_categories` — id, shop_id, name, i18n_key null (set for seeded defaults), icon, sort, archived_at null. Defaults seeded per shop type.

### Ledgers (append-only — never update or delete)
- `sales` — id, shop_id, receipt_no (`<device code>-<counter>` e.g. `A3-000123`), business_date, staff_id, customer_id null, order_type (`walk_in` | `delivery`), source (`walk_in` | `phone` | `foodpanda` | …), subtotal_paisa, discount_paisa, rounding_paisa, total_paisa, note. **Bill rounding** (decided 21 Nov 2026): the bill is rounded to the nearest whole rupee, half up, before payment; `rounding_paisa` is signed (between −50 and +50, e.g. +50 for Rs 214.50 → Rs 215) and `total_paisa = subtotal_paisa − discount_paisa + rounding_paisa` (checked in SQL; `roundBill()` in core). `receipt_no` is unique per shop; the per-device counter never goes below the highest receipt number of the device code already in local sales.
- `sale_lines` — id, shop_id, sale_id, product_id null (null = custom item), name_snapshot, name_ur_snapshot null, unit_snapshot, qty_milli, unit_price_paisa, discount_paisa, is_foc, by_amount, line_total_paisa. `by_amount` = "Rs 100 of tomatoes": the typed amount is the line total and qty is derived (5 g steps), so qty × rate may differ from the total. `line_total_paisa` is the line **net of its own discount**; `discount_paisa` is that line discount. A free (FOC) line has `is_foc`, `line_total_paisa = 0` and no discount (SQL check); `unit_price_paisa` is kept so reports can value it, and stock still moves (US024).
- **Discounts and FOC** (decided 22 Nov 2026, US032 / US033). Order of calculation: line totals → line discounts → bill discount → round to the nearest rupee (`roundBill`) → total. `sales.subtotal_paisa` = sum of line nets; `sales.discount_paisa` is the **bill discount only** (≤ subtotal, SQL check). Discounts are Rs or a whole % (1–100, converted to paisa half up in core) and can never make a line or the bill negative (`computeBill()` in core). `sales.discount_approved_by_staff_id` (nullable, an owner of the shop: trigger check) records who approved a give-away above the cashier limit (§5).
- `payments` — id, shop_id, business_date, kind (`sale` | `khata_receipt` | `refund` | `supplier_payment` | `rider_handover`), sale_id null, customer_id null, method_code (FK to the shop's `payment_methods.code`), amount_paisa (> 0; for cash the amount applied to the bill, never the amount tendered), reference null, staff_id.
- Sales, lines and payments of one sale are written in **one** Dexie transaction with their outbox entries, the receipt counter and the cleared cart. Owners and cashiers read and write them (RLS + `write_roles {owner, cashier}`); riders do not (rider stories later). No update or delete privilege.
- `khata_entries` — id, shop_id, customer_id, business_date, type (`credit_sale` | `payment` | `return_credit` | `adjustment`), amount_paisa (**positive = customer owes more**), sale_id null, payment_id null.
- `stock_movements` — id, shop_id, product_id, business_date, qty_milli (signed, never 0), reason (`sale` | `return` | `purchase` | `wastage` | `damaged` | `count_correction` | `combo_component`), ref_id null (for `sale`: the sale id), note null (≤ 200), staff_id, device_id, created_at. Append-only; owners and cashiers read and insert, riders none. Decisions (22 Nov 2026):
  - **No cost column.** Every device pulls this table, so a cost would reach cashiers. The value of wastage is computed in owner reports from `product_cost_history` at that date.
  - **Stock never blocks a sale** (rule 1). Stock can go negative; the app shows stock ≤ 0 in amber with "check stock".
  - A completed sale writes one `sale` movement (negative) per line whose product has `track_stock` on, in the sale's transaction. Custom items never move stock.
  - Until purchases exist (R2), stock gets in through the owner's **Stock in** (`purchase`, no supplier yet) and **Set stock (count)** (`count_correction`: the device writes counted − current stock, nothing when equal, and keeps the count in `note`, e.g. "counted 12.5 kg"). Before a count the app runs Sync now (8 s at most) so other devices' sales are included; offline or on failure it asks "Other devices' sales may be missing — count anyway?".
  - Per-reason rules, also in SQL (`stock_movements_check()` trigger): `purchase` and `count_correction` only by an owner (the acting staff member in `sync_push`, else the signed-in user); `sale` only with `ref_id` of a sale of the shop (otherwise a foreign-key error, retried as `missing_parent`). `wastage` / `damaged` by owners and cashiers.
- `expenses` — id, shop_id, business_date, category_id, amount_paisa (negative only for reversals), paid_method_code, note null, payee null, payee_staff_id null, staff_id, approved_by_staff_id null, reverses_expense_id null (unique — an expense can be reversed once), reversal_reason null, recurring_expense_id null. A wrong expense is fixed by a reversal row, never by editing. See `docs/features/expense-management.md`.
- `expense_attachments` — id, shop_id, expense_id, storage_path (`bill-photos/<shop_id>/<expense_id>.jpg`), uploaded_at. Separate append-only table so the photo can be added after upload without updating the expense row.
- `day_closes` — id, shop_id, business_date (unique per shop), opening_cash_paisa, expected_cash_paisa, counted_cash_paisa, difference_paisa, owner_withdrawal_paisa (cash the owner takes home — not an expense), note, closed_by_staff_id, closed_at. Once a day is closed, no ledger row may be created with that business_date (enforced in core and in `sync_push`).

### Release 2+
- `suppliers`, `purchases`, `purchase_lines`, `supplier_ledger` (append-only, positive = shop owes more).
- `deliveries` — sale_id, rider_staff_id, address, status (`new` | `out` | `delivered` | `cancelled`), status_history jsonb, collected_method, collected_paisa.
- `global_catalogue` — barcode, name, unit, status (`pending` | `approved`) — shared across shops.
- `message_log` — WhatsApp sends per customer per day (cost tracking).
- `recurring_expenses` (mutable) — id, shop_id, category_id, amount_paisa, method_code, frequency (`monthly` | `weekly`), due_day, next_due_date, active.
- `partners`, `partner_settlements`, `plans`, `subscriptions`.

### Derived values (never stored as editable fields)
- Stock of a product = `sum(stock_movements.qty_milli)` (`stockOf()` / `stockByProduct()` in core, the `product_stock` view on the server; shared fixture `packages/core/src/fixtures/stock-movements.json`).
- Khata balance = `sum(khata_entries.amount_paisa)` per customer.
- Expected cash for a day = opening cash + cash sale payments + cash khata receipts + rider handovers − cash expenses (net of reversals) − cash refunds − cash supplier payments − owner withdrawal. Only expenses paid in cash count; wallet, bank and non-cash expenses (e.g. wastage at cost) do not.
- Expense totals = `expenseTotals()` in core: by category and method, reversals netted out.
Compute these with pure functions in `packages/core` (client) and matching SQL views/functions (server). Both must agree — keep a shared test fixture.

## 4. Sync design

### Push (device → server)
1. Every local write = one Dexie transaction that writes the row **and** an `outbox` entry `{id, table, op: 'insert' | 'upsert', row, row_key, created_at, attempts, actor_staff_id}` (`apps/pos/src/db/outbox.ts`). `actor_staff_id` is the PIN-switched staff member, or the owner who entered their PIN on an owner screen. Ids are **monotonic UUIDv7** (RFC 9562 counter within a millisecond), so outbox id order is creation order and parents (a sale, a new product) are always pushed before children, across batches too.
2. The sync engine sends outbox entries in batches (max 200) to `POST /sync/push` `{device_id, entries}`. `device_id` must equal `X-Device-Id` (it becomes `app.device_id`). The API validates each row with its table's shared Zod schema (a bad row is a per-entry `invalid` error, not a failed batch) and calls the SQL function `sync_push(device_id, entries)` in one transaction with the user set (§9).
3. `sync_push` runs in one transaction per batch, each entry in its own sub-transaction, as the signed-in user (security invoker, so RLS and column grants apply):
   - the device must exist, not be removed, and belong to a shop the user is a member of; otherwise the whole call is refused (API 403);
   - append-only tables: `INSERT … ON CONFLICT (id) DO NOTHING` (idempotent — retries never duplicate);
   - mutable tables: upsert only if incoming `updated_at` > stored `updated_at` (last write wins). The **same `updated_at` with the same content** is a retry and is accepted silently. Otherwise (older, or same time with different content) record a row in `sync_conflicts`, keep the server version and **return the server row** in `conflicts`;
   - per-entry errors, never failing the batch: `other_shop`, `day_closed` (`is_day_closed()`), `forbidden` (RLS; a table whose `pull_scope` does not admit the device's mode: a shop device runs on the owner's session, so RLS alone would allow it; or a table with `write_roles` whose entry has no active `actor_staff_id` of the device's shop with one of those roles. The PIN is checked offline on the device, so the actor check guards against a buggy or tampered UI, not against someone who controls the device: the trust boundary stays the session plus the device mode), `clock_ahead` (mutable `updated_at` or append-only `created_at` more than 10 minutes ahead of server time), `missing_parent` (a foreign-key violation: the parent row is not on the server yet; the device keeps the entry and retries it on the next sync, and only after 24 hours of retries it becomes a normal error), `invalid`, `unknown_table`, `not_pushable`. For each entry `sync_push` sets `app.actor_staff_id` (transaction-local, cleared at the end) so table triggers can check the acting staff member, e.g. `stock_movements_check()`.
4. Returns `{accepted, conflicts: [{id, table, row}], errors: [{id, code, message?}]}`. The device deletes accepted and conflict entries from the outbox, **writes each conflict's server row into Dexie** (otherwise it would keep the losing edit forever: the server row's `server_seq` did not change, so pull never resends it), and moves errors to `sync_errors` for review. "Sync now" re-queues `clock_ahead` entries with future timestamps set to the (corrected) device time.
5. Triggers: app start, `online` event, after each local write (debounced 5s), every 60s while online, manual "Sync now". Backoff on network/server failure: 5s, 15s, 60s, then every 5min; the 60s tick and write triggers wait for a pending backoff. **401** (session gone) and **403** (no longer a member, device removed) pause sync with no retries, keep the outbox and store the reason (`auth_required` / `device_unlinked`); the app never signs the user out because of it, and only "Sync now" tries again.

### Pull (server → device)
1. `GET /sync/pull?device_id&since_seq&limit` (SQL function `sync_pull`, limit default 500, max 1000) returns `{rows: [{table, row, server_seq}], next_seq, has_more}`: rows of the device's shop from all registered tables the device may see (RLS, plus `pull_scope = owner_device` tables only for `owner`-mode devices) where `server_seq > since_seq`, ordered by `server_seq`. It records `last_seq_pulled` and `last_sync_at` on the device.
2. The device applies them to Dexie and stores the new cursor. Repeat until `has_more` is false. A row with a local edit still in the outbox is not overwritten (that edit is newer on the device and comes back after its push). Tables the app version does not know are skipped.
3. Because skipped rows lie behind the cursor, the device stores the cursor together with the set of sync table names it was built with (`meta.sync_cursor_tables`). Before each pull, if the app now knows a table that is not in that set (an update added one, e.g. `staff_pins`), or the set is missing while the cursor is above 0, the cursor goes back to 0 and the set is saved: the next pull reads everything again. Pull is idempotent and rows with a pending local edit are still protected (decided 21 Nov 2026).
4. Pull runs after every successful push.

### Device modes and what syncs
The mode is stored in `devices.mode` and applies to pull **and** push.
- **Owner device** (owner signed in online, see §5): everything for the shop, including `product_costs` and `staff_salaries`.
- **Shop device** (shared counter phone/PC, registered by the owner): staff switch with PIN; `product_costs` and owner-only report data are **not** pulled. Owner actions on a shop device (reports, cost prices, closing approval) require the owner PIN and fetch owner-only data online.
- **Rider device** (rider's own phone, see §5): only the rider's assigned deliveries, the related sales/customers, and their own handover balance. No `staff_pins` at all; how a rider device unlocks with the rider's own PIN is designed with the rider stories.
- Owner screens (staff now; reports, cost prices later) need an owner: on an owner device the switched-in owner goes straight through; on a shop device, or when someone else is switched in, an owner types their PIN each time the screen opens.

### Receipt numbers offline
Each registered device gets a short code (`A1`, `A2`, …). Receipt number = device code + per-device counter stored in Dexie. Unique without the network. Codes are assigned by the SQL function `register_device` (`POST /devices`, owner only) in registration order per shop: `A1…A999`, then `B1…`; devices are never deleted, so a code is never reused.

### App version and compatibility (decided 20 Nov 2026)
Devices can stay offline for days and then push data made by an older app version. Rules:
- Every API request from `apps/pos` sends the app version in an `X-App-Version` header (from the build, e.g. `package.json` version).
- **The API stays backward compatible** with older sync payloads: new fields are optional with defaults, and fields are never renamed or removed while devices on older versions are still active. Shared Zod schemas must keep accepting the old shape.
- **Breaking change (rare):** the API setting `MIN_APP_VERSION` (env var) is raised. `/sync/push` and `/sync/pull` then answer older apps with `426 Upgrade Required` and `{ min_version }`.
- On `426` the app **pauses sync only — selling continues offline** (rule 1). The outbox keeps every entry. A persistent banner shows "Update required to sync — Reload" (i18n `sync.updateRequired`), and the update check (§6) runs immediately. After reload, sync resumes and pushes the waiting outbox.
- `syncHealth` treats "update required" as at least `warning` (reason `update_required`), and likewise the paused auth states (reasons `auth_required`, `device_unlinked`).
- A missing or malformed `X-App-Version` counts as older while `MIN_APP_VERSION` is set. The gate runs before the session check.

## 5. Auth and access

### Sign-in methods (decided Nov 2026)
Login runs inside our API with **Better Auth** (open-source library). Users and sessions are rows in our own Postgres, so there are no per-user fees and nothing to migrate if we change hosts. Phone OTP is **deferred**: international SMS APIs cost roughly Rs 72–133 per OTP to Pakistan, and WhatsApp authentication templates need a registered, Meta-verified business (not done yet).

| Who | Sign-in | Notes |
| --- | --- | --- |
| Owner | **Sign in with Google** (primary), **email OTP** (fallback) | Mobile number is collected in onboarding and stored on the owner's `staff.phone` and on `shops.phone`. It is profile data, not a login identity. |
| Rider with own phone | Sign in with Google or email OTP | Owner invites the rider by email. **Open:** invite flow (may need an `invites` table — ask before adding). |
| Rider without Google/email | Owner signs in once on the rider's phone and registers it as a rider device; rider then uses their staff PIN | **Open — confirm with pilot shops.** |
| Cashier / counter staff | Staff PIN on a registered shop device | No online account. |
| System admin | Google sign-in **plus TOTP (authenticator app) as a required second factor** (Better Auth two-factor plugin) | `/admin/*` routes require a session that passed 2FA. |

- **Email OTP uses a typed 6-digit code, not a magic link.** A magic link opens in the browser, not the installed PWA, so the session would land in the wrong place. Codes are sent through any SMTP provider (`SMTP_*` settings).
- **Google sign-in hand-off:** Google returns to the API, which redirects to the app's `/auth/callback` with a single-use token in the URL fragment (`#ott=…`, Better Auth one-time-token plugin: minted only by the server, stored hashed, valid 1 minute). The app trades it for the bearer token at `/auth/one-time-token/verify` and removes it from the address bar. The bearer token never appears in a URL.
- **Google sign-in in an installed PWA must be tested on iOS.** OAuth redirects from a Home Screen app can open in Safari and lose the session. If it fails, iOS owners use email OTP.
- Google and email OTP with the same verified email resolve to one user (Better Auth account linking).
- **Sessions:** the API issues a long-lived session token (bearer token in an `Authorization` header, stored on the device in Dexie `meta`), valid 90 days and extended while online (checked at most once a day). Sign-in is needed only on a new device or after logout. An existing session keeps working offline; selling never waits for auth (rule 1). **The app never clears the session by itself:** when the server no longer knows it (401 or a null session), sync pauses with `auth_required` and the Sync screen offers "Sign in again". Re-sign-in keeps the device: the same user just replaces the token; another user is refused while the outbox has entries, and otherwise accepted only if their role in the device's shop is `owner` (a cashier or rider is refused: "Only the shop owner can sign in on this device").
- **Later** (after business registration and Meta verification): phone OTP through a WhatsApp authentication template, with SMS as fallback (Better Auth phone-number plugin). No ledger table changes expected.

### Access rules
- Staff PIN: 4 digits, hashed (PBKDF2 via WebCrypto) in `staff_pins` and synced to owner and shop devices so it works offline. After 5 wrong tries the keypad locks, longer each time: 1 minute, then 5 minutes, then 15 minutes for every further lockout (`PIN_LOCK_STEPS_MS` in `packages/core/src/pinLock.ts`); a correct PIN resets the count and the lockout level. Counted per device across all staff (kept in Dexie `meta`, so a reload does not reset it). Deactivated staff cannot switch in. The current staff member is kept in Dexie `meta` and stamped on outbox entries (`actor_staff_id`) and ledger rows (`staff_id`).
- Role checks use `can(role, action)` in `packages/core/src/permissions.ts` (UI and API routes), with RLS and `sync_tables.write_roles` on the server.
- **"A cashier sees only their own sales" is a UI rule** (Today's sales, sale view). On a shared shop device the session is the owner's, so the server cannot tell who is looking; the device holds the shop's sales for closing anyway. The server-side rules are: riders get no sales, and only owners and cashiers may create them.
- **Owner "Forgot PIN?"** (decided 21 Nov 2026): online only. Offered on the owner keypad (and when no PIN is on the device yet) for the owner staff row linked to the signed-in account (`staff.membership_user_id`; `create_shop` always links it). `POST /staff/{id}/pin-code` emails a code to the **session's** email (Better Auth email-OTP, type `email-verification`, worded "PIN reset code"); at most one per 60 seconds and 10 per 24 hours per user, counted from `audit_log` `pin.code_sent`. `POST /staff/{id}/pin` `{ code, pin_hash }` checks the code server-side with `verifyEmailOTP` (used up on check, 3 wrong tries, 5 minutes, no session created), then `reset_owner_pin()` writes `staff_pins` (other devices pull it) and `audit_log` `pin.reset` with only the staff id. The route and SQL both require an active owner row linked to the caller in a shop they own. Not an outbox write: the device stores the returned row at once, clears the PIN lock and switches that owner in, so the new PIN works offline right away.
- **Two layers, both required:** the API checks the session and role on every route, **and** Postgres RLS enforces the same rules. Each request runs in a transaction that first does `set_config('app.user_id', <user id>, true)` (and `app.device_id` from the `X-Device-Id` header that registered devices send). SQL helper `current_user_id()` reads it; helpers `is_shop_member(shop_id)`, `has_shop_role(shop_id, roles)` and `is_platform_admin()` build on it.
- RLS on every table: `shop_id in (select shop_id from memberships where user_id = current_user_id())`, plus role-specific policies (riders: deliveries where `rider_staff_id` is theirs; `product_costs` and `staff_salaries`: owners only; shop devices pull only expenses for open business dates; riders get no expenses).
- **Database roles:** migrations run as the owner role. The API connects as `naqdpos_app`, which owns nothing and has no `BYPASSRLS`, so RLS always applies to it. Only the worker's admin jobs (backups, maintenance) use a separate privileged role.
- **Login tables:** Better Auth must read sessions before any user is known, so the RLS policies on `users`, `sessions`, `accounts`, `verifications` and `two_factors` allow `naqdpos_app` only when `current_setting('app.context') = 'auth'`. Better Auth's own pool sets that as a connection startup option; the per-request pool never does, so tenant queries cannot read tokens or TOTP secrets. Same role and `DATABASE_URL` for both pools.
- Discounts (US032): a cashier's **give-away** per bill = line discounts + bill discount + FOC value (qty × unit price) must stay ≤ `shops.cashier_max_discount_pct` % of the paid lines' price before discounts (FOC lines are not in that base). Above it an owner enters their PIN (OwnerPinGate rules) at Charge, when applying a bill discount, or before completing if the bill changed; the approval covers the amount the owner saw. Owners have no limit. The server cannot tell who stands at a shared device, so this is enforced in core (`withinLimit`, `buildSale` → `over_limit`) and recorded for the audit trail in `sales.discount_approved_by_staff_id` (same approach as the expense limit).
- Expenses: cashiers may add up to `cashier_expense_limit_paisa`; above it the owner's PIN is required (`approved_by_staff_id`). Only owners reverse expenses, manage categories and recurring expenses, and see expense reports.
- System admins: `platform_admins` grants access to all shops through `/admin/*` routes; every admin write goes to `audit_log` with `acting_as_admin = true`.

## 6. PWA and device storage

### PWA requirements (`apps/pos`)
- Served over **HTTPS** only (service workers need it).
- **Manifest** (via `vite-plugin-pwa`): `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, `theme_color`, `background_color`, `lang`, `dir`. Urdu UI switches `dir` at runtime; the manifest default is `ltr`.
- **Icons**: 192 and 512 px, a `maskable` 512 px, and `apple-touch-icon` (180 px). Add `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style` meta tags for iOS.
- **Precache the full app shell**: all JS/CSS, the Urdu font, icons and i18n JSON. The app must open and complete a sale on first launch after install with the network off.
- **Updates**: `registerType: 'prompt'`. Show a "New version available — Reload" banner. Never auto-reload, and never show the prompt while a cart has items.
- **Update checks** (decided 20 Nov 2026): the browser only checks for a new service worker when the app is opened or navigated, and shop PCs may stay open for days. So the app also calls `registration.update()` **every 60 minutes while online**, when the window **becomes visible or regains focus**, and immediately when the API answers `426` (§4). Requires `sw.js` served with `no-cache` (`docs/deployment.md` §4).
- **Install**: capture `beforeinstallprompt` (Android/desktop) and show our own "Install app" button; on iOS show a short "Share → Add to Home Screen" guide. Installing is a step in owner onboarding.
- **Desktop install** (shop PCs): same code path. Chrome and Edge (Windows, macOS, Linux, ChromeOS) fire `beforeinstallprompt`, so our button works. Safari on macOS shows a "File → Add to Dock" guide. Firefox desktop has no install support: the guide recommends Chrome or Edge for counter PCs. The installed app opens in its own window and works offline the same as on a phone.
- Do **not** depend on the Background Sync API (not supported on iOS). Sync triggers in §4 work without it.

### Storage persistence
IndexedDB is best-effort by default: the browser may evict it under storage pressure, iOS Safari clears storage for sites unused for ~7 days unless installed to the Home Screen, and users can clear site data.

- On first run and on every app start until granted, call `navigator.storage.persist()`. Store the result locally (Dexie `meta` table, key `storage_persisted`).
- Check free space with `navigator.storage.estimate()` on app start and every 30 minutes.
- If persistence is not granted, show a one-time owner notice explaining the risk and asking them to install the app.
- The server is the long-term store; Dexie only needs to keep data safe until the next successful push. Sync reminders (§7) keep that window short.
- **Export backup** (owner PIN): downloads the outbox plus unsynced ledger rows as a JSON file. **Import backup** pushes that file's entries through `sync_push` (idempotent, so duplicates are harmless).

## 7. Sync status, reminders and warnings

Selling never waits for sync (rule 1). Reminders and warnings are **non-blocking**, except the guarded actions listed below, none of which are in the selling flow.

### Sync health
A pure function in `packages/core/src/syncHealth.ts` computes the level from device state, so it is unit-tested and the thresholds live in one place:

```ts
syncHealth({
  outboxCount, oldestOutboxAt, unsyncedSalesCount, errorCount,
  isOnline, lastSyncAt, storagePersisted, storageUsedRatio, updateRequired, authProblem, now,
}) => { level: 'ok' | 'pending' | 'reminder' | 'warning' | 'critical', reasons: string[] }
```

| Level | When (any one condition) | What the user sees |
| --- | --- | --- |
| `ok` | outbox empty, no errors | Small green tick in the header |
| `pending` | outbox has entries, oldest < 30 min | Amber badge with unsynced count; tap opens the Sync screen |
| `reminder` | every **25 unsynced sales** since the last reminder, or oldest unsynced entry ≥ **2 h** | Dismissible toast: "25 sales not synced. Connect to internet and tap Sync now." Shown after the sale completes (on the receipt screen), never during cart entry. At most once per 30 min. |
| `warning` | oldest unsynced ≥ **12 h**, or unsynced sales ≥ **100**, or storage not persisted with any unsynced data, or storage used ≥ **80%**, or **update required** (§4), or sync paused by **401 / 403** (§4) | Persistent amber banner on the sell screen with "Sync now" (or "Reload" when an update is required). Cannot be dismissed until the condition clears. |
| `critical` | oldest unsynced ≥ **24 h**, or storage used ≥ **95%**, or any rejected entries (`errorCount > 0`) | Persistent red banner on every screen. Owner sees a "Needs review" list for rejected entries. Prompt to export a backup. |

Thresholds are constants in `syncHealth.ts`; a per-shop override can come later through shop settings (would need an architecture change — ask first).

### Notifications after transactions
- After each completed sale, khata payment, expense or refund: the outbox write triggers a debounced push (§4). If the device is offline, the receipt screen shows a small "Saved offline — will sync when online" line.
- The `reminder` toast (above) is evaluated after each completed transaction.
- When a push succeeds after being offline, show a short toast: "Synced 37 records".

### Guarded actions (warn or block before proceeding)
| Action | Behaviour if outbox is not empty |
| --- | --- |
| Logout / switch shop / unregister device | **Blocked.** Offer "Sync now"; if offline, allow only with owner PIN after a mandatory backup export (not built yet: sign-out is simply blocked). Signing out keeps the device registration and shop data. |
| Clear app data (in-app reset) | Same as logout. |
| Daily closing | Try to sync first. If offline, allow closing with a warning ("Closing offline — totals from other devices may be missing") and record it in the closing note. |
| App update reload | Allowed (data is in IndexedDB, not memory), but only when the cart is empty. |

### Server-side stale-device alert (Release 2)
A scheduled worker job (pg-boss) checks `devices.last_sync_at`. If a device has not synced for 24 h, it notifies the owner by WhatsApp/SMS (once per day per device). Depends on the WhatsApp/SMS provider decision (§8).

### i18n
All sync messages go through `t()` with keys under `sync.*` in both `en.json` and `ur.json`. Counts use i18next plurals.

## 8. Key decisions still open
- SMTP provider for email OTP codes (§5).
- Phone OTP provider (WhatsApp authentication template, SMS fallback) — deferred until business registration and Meta verification (§5).
- Rider invite flow, and sign-in for riders without Google or email (§5).
- Cost price method on purchase: latest cost vs weighted average (US051).
- WhatsApp Business API provider (US058).
- Pricing and plans (pricing doc not yet decided).
- Whether devices report `storage_persisted` and outbox size to the server (would add columns to `devices`) so the owner/admin can see at-risk devices.
- Whether the server stores each device's last seen app version (`devices.app_version`, from `X-App-Version`) so admin can see which versions are still active before raising `MIN_APP_VERSION` (§4). Would add a column — ask first.

## 9. API service (`apps/api`)

- **Stack:** Node 24 LTS, TypeScript, Hono, `@hono/zod-openapi` (request/response schemas from `packages/core`, OpenAPI docs generated), Kysely on the `pg` driver, Better Auth, pino logs, pg-boss for jobs, `@aws-sdk/client-s3` for files.
- **Thin layer over SQL:** routes validate input, open a transaction, set `app.user_id` / `app.device_id`, call SQL functions or Kysely queries, and return JSON. Business rules shared with the device live in `packages/core`; data rules (RLS, closed-day checks, idempotent inserts) live in SQL.
- **Routes (initial):** `/auth/*` (Better Auth), `POST /shops` (create shop + owner membership + owner staff), `POST /devices` (register), `POST /devices/{id}/mode` (owner phone ↔ shop counter), `POST /staff/{id}/pin-code` and `POST /staff/{id}/pin` (owner PIN reset), `POST /sync/push`, `GET /sync/pull`, `/reports/*` (owner), `/files/*` (pre-signed upload/download URLs), `/admin/*` (platform admin, 2FA), `GET /health`.
- **Files:** the API never streams large files. It returns pre-signed S3 URLs; the device uploads directly to storage. Rows store only the key (e.g. `bill-photos/<shop_id>/<expense_id>.jpg`).
- **Worker:** same package, separate entry point (`pnpm --filter api worker`). Runs pg-boss jobs: WhatsApp/SMS sends, stale-device alerts, nightly backup to storage.
- **Config:** only environment variables (`DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_*`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGINS`, `MIN_APP_VERSION` (optional; unset = accept all versions, see §4)). `.env.example` lists them all.
- **Scaling:** stateless; add API copies as load grows. Use a connection pooler (PgBouncer, transaction mode) when copies × pool size gets close to Postgres's connection limit; `set_config(..., true)` is transaction-scoped so it is safe with transaction pooling.
