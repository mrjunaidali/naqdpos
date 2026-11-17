# NaqdPOS architecture

Source of truth for the data model, sync and access rules. AI sessions must follow it and ask before changing it.

## 1. System overview

```
 Shop device (PWA)                         Supabase
 ┌──────────────────────────┐             ┌───────────────────────────────┐
 │ React UI                 │             │ Postgres (+ RLS)              │
 │   ↕ useLiveQuery         │  push/pull  │   tables, views               │
 │ Dexie (IndexedDB)        │ ──────────► │   rpc: sync_push, sync_pull   │
 │   data tables + outbox   │ ◄────────── │   rpc: reports, closing       │
 │ Sync engine (bg, retry)  │             │ Auth (Google, email OTP)      │
 │ Service worker (Workbox) │             │ Edge Functions: whatsapp,     │
 └──────────────────────────┘             │   scheduled jobs, sms         │
 Admin portal (online) ─────────────────► │ Storage: bill photos, logos   │
                                          └───────────────────────────────┘
```

- The UI only reads from Dexie. The sync engine moves data between Dexie and Postgres.
- The admin portal talks to Supabase directly (online only).

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
- `shops` — id, name, type (`fruit_veg` | `grocery` | `meat` | `general`), address, phone, receipt_footer, logo_path, status (`active` | `suspended`), plan_id, timezone (default `Asia/Karachi`), cashier_expense_limit_paisa (default 200000 = Rs 2,000).
- `memberships` — user_id (auth.users), shop_id, role (`owner` | `cashier` | `rider`). Online logins (owners; riders who sign in on their own phone). See §5.
- `staff` — id, shop_id, name, phone, role (`owner` | `cashier` | `rider`), pin_hash, membership_user_id null, active, monthly_salary_paisa null (owner-only; used by US071). Every sale/expense records `staff_id`.
- `devices` — id, shop_id, name, registered_by, last_sync_at, last_seq_pulled.
- `platform_admins` — user_id.
- `audit_log` — id, shop_id, actor_user_id, acting_as_admin bool, action, entity, entity_id, payload jsonb, at.

### Catalogue (mutable, last-write-wins)
Product and category names are stored in both languages in the same row: `name` (English) and `name_ur` (Urdu, nullable). The UI shows the name for the current language and falls back to the other one if empty. Only English and Urdu are supported (Pakistan only).
- `categories` — id, shop_id, name, name_ur null, sort.
- `products` — id, shop_id, category_id, name, name_ur null, unit (`kg` | `g` | `dozen` | `piece` | `bundle` | `litre`), sale_price_paisa, barcode null, track_stock bool, min_qty_milli null, is_combo bool, packaging_cost_paisa, foc_rule jsonb null. Varieties (e.g. small and big green chilli, Sindhri and Chaunsa mango) are separate products. Products can be created from the built-in fresh produce list (`docs/features/produce-presets.md`).
- `product_costs` — product_id, shop_id, cost_price_paisa. **Separate table so it never syncs to cashier-mode devices.**
- `price_history` (append-only) — product_id, sale_price_paisa, cost_price_paisa null, effective_at.
- `combo_items` — combo_product_id, item_product_id, qty_milli.
- `customers` — id, shop_id, mobile (E.164, unique per shop), name, address, credit_limit_paisa null, whatsapp_opt_in bool.
- `payment_methods` — id, shop_id, code (`cash` | `jazzcash` | `easypaisa` | `bank` | custom), label, active.
- `expense_categories` — id, shop_id, name, i18n_key null (set for seeded defaults), icon, sort, archived_at null. Defaults seeded per shop type.

### Ledgers (append-only — never update or delete)
- `sales` — id, shop_id, receipt_no (`<device code>-<counter>` e.g. `A3-000123`), business_date, staff_id, customer_id null, order_type (`walk_in` | `delivery`), source (`walk_in` | `phone` | `foodpanda` | …), subtotal_paisa, discount_paisa, total_paisa, note.
- `sale_lines` — id, sale_id, product_id null (null = custom item), name_snapshot, unit_snapshot, qty_milli, unit_price_paisa, discount_paisa, is_foc, line_total_paisa.
- `payments` — id, shop_id, business_date, kind (`sale` | `khata_receipt` | `refund` | `supplier_payment` | `rider_handover`), sale_id null, customer_id null, method_code, amount_paisa, reference null, staff_id.
- `khata_entries` — id, shop_id, customer_id, business_date, type (`credit_sale` | `payment` | `return_credit` | `adjustment`), amount_paisa (**positive = customer owes more**), sale_id null, payment_id null.
- `stock_movements` — id, shop_id, product_id, business_date, qty_milli (signed), reason (`sale` | `return` | `purchase` | `wastage` | `damaged` | `count_correction` | `combo_component`), ref_id null, cost_paisa null.
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
- Stock of a product = `sum(stock_movements.qty_milli)`.
- Khata balance = `sum(khata_entries.amount_paisa)` per customer.
- Expected cash for a day = opening cash + cash sale payments + cash khata receipts + rider handovers − cash expenses (net of reversals) − cash refunds − cash supplier payments − owner withdrawal. Only expenses paid in cash count; wallet, bank and non-cash expenses (e.g. wastage at cost) do not.
- Expense totals = `expenseTotals()` in core: by category and method, reversals netted out.
Compute these with pure functions in `packages/core` (client) and matching SQL views/RPCs (server). Both must agree — keep a shared test fixture.

## 4. Sync design

### Push (device → server)
1. Every local write = one Dexie transaction that writes the row **and** an `outbox` entry `{id, table, op: 'insert' | 'upsert', row, created_at, attempts}`.
2. The sync engine sends outbox entries in batches (max 200) to `rpc('sync_push', {device_id, entries})`.
3. `sync_push` runs in one transaction per batch:
   - append-only tables: `INSERT … ON CONFLICT (id) DO NOTHING` (idempotent — retries never duplicate);
   - mutable tables: upsert only if incoming `updated_at` > stored `updated_at` (last write wins); otherwise record a row in `sync_conflicts` and keep the server version;
   - rejects rows for a closed business_date or another shop (returns per-entry errors, does not fail the batch).
4. Returns accepted ids and per-entry errors; the device deletes accepted outbox entries and marks errors for review.
5. Triggers: app start, `online` event, after each sale (debounced 5s), every 60s while online, manual "Sync now". Backoff on failure: 5s, 15s, 60s, 5min.

### Pull (server → device)
1. `rpc('sync_pull', {device_id, since_seq, limit})` returns rows from all tables the device may see where `server_seq > since_seq`, ordered by `server_seq`.
2. The device applies them to Dexie and stores the new cursor. Repeat until empty.
3. Pull runs after every successful push.

### Device modes and what syncs
- **Owner device** (owner signed in online, see §5): everything for the shop, including `product_costs`.
- **Shop device** (shared counter phone/PC, registered by the owner): staff switch with PIN; `product_costs` and owner-only report data are **not** pulled. Owner actions on a shop device (reports, cost prices, closing approval) require the owner PIN and fetch owner-only data online.
- **Rider device** (rider's own phone, see §5): only the rider's assigned deliveries, the related sales/customers, and their own handover balance.

### Receipt numbers offline
Each registered device gets a short code (`A1`, `A2`, …). Receipt number = device code + per-device counter stored in Dexie. Unique without the network.

## 5. Auth and access

### Sign-in methods (decided Nov 2026)
Phone OTP is **deferred**. International SMS APIs cost roughly Rs 72–133 per OTP to Pakistan, and WhatsApp authentication templates need a registered, Meta-verified business (not done yet). Sign-in instead uses Supabase Auth providers that are free and need no business registration.

| Who | Sign-in | Notes |
| --- | --- | --- |
| Owner | **Sign in with Google** (primary), **email OTP** (fallback) | Mobile number is collected in onboarding and stored on the owner's `staff.phone` and on `shops.phone`. It is profile data, not a login identity. |
| Rider with own phone | Sign in with Google or email OTP | Owner invites the rider by email. **Open:** invite flow (may need an `invites` table — ask before adding). |
| Rider without Google/email | Owner signs in once on the rider's phone and registers it as a rider device; rider then uses their staff PIN | **Open — confirm with pilot shops.** |
| Cashier / counter staff | Staff PIN on a registered shop device | No online account. |
| System admin | Google sign-in **plus TOTP (authenticator app) as a required second factor** | Admin portal requires AAL2. |

- **Email OTP uses a typed 6-digit code, not a magic link.** A magic link opens in the browser, not the installed PWA, so the session would land in the wrong place.
- **Google sign-in in an installed PWA must be tested on iOS.** OAuth redirects from a Home Screen app can open in Safari and lose the session. If it fails, iOS owners use email OTP.
- Email OTP needs a custom SMTP provider in Supabase (the built-in mailer is rate-limited and meant for testing). Choose one with a free tier (deployment §3).
- A person who uses both Google and email OTP with the same verified email must resolve to one auth user (Supabase identity linking) — confirm in setup.
- Sessions stay signed in on the device (refresh token). Sign-in is needed only on a new device or after logout, so it is rare. An existing session keeps working offline; selling never waits for auth (rule 1).
- **Later** (after business registration and Meta verification): add phone OTP through a WhatsApp authentication template, with SMS as fallback. This adds a login identity in Supabase Auth; no table change expected.

### Access rules
- Staff PIN: 4 digits, hashed (PBKDF2 via WebCrypto) and synced to the shop's devices so it works offline. Lock after 5 wrong tries for 1 minute.
- JWT → `memberships` gives the user's shop and role. RLS on every table:
  `shop_id in (select shop_id from memberships where user_id = auth.uid())`, plus role-specific policies (riders: deliveries where `rider_staff_id` is theirs; `product_costs` and `staff.monthly_salary_paisa`: owners only; shop devices pull only expenses for open business dates; riders get no expenses).
- Expenses: cashiers may add up to `cashier_expense_limit_paisa`; above it the owner's PIN is required (`approved_by_staff_id`). Only owners reverse expenses, manage categories and recurring expenses, and see expense reports.
- System admins: `platform_admins` grants access to all shops through admin RPCs; every admin write goes to `audit_log` with `acting_as_admin = true`.

## 6. PWA and device storage

### PWA requirements (`apps/pos`)
- Served over **HTTPS** only (service workers need it).
- **Manifest** (via `vite-plugin-pwa`): `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, `theme_color`, `background_color`, `lang`, `dir`. Urdu UI switches `dir` at runtime; the manifest default is `ltr`.
- **Icons**: 192 and 512 px, a `maskable` 512 px, and `apple-touch-icon` (180 px). Add `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style` meta tags for iOS.
- **Precache the full app shell**: all JS/CSS, the Urdu font, icons and i18n JSON. The app must open and complete a sale on first launch after install with the network off.
- **Updates**: `registerType: 'prompt'`. Show a "New version available — Reload" banner. Never auto-reload, and never show the prompt while a cart has items.
- **Install**: capture `beforeinstallprompt` (Android/desktop) and show our own "Install app" button; on iOS show a short "Share → Add to Home Screen" guide. Installing is a step in owner onboarding.
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
  isOnline, lastSyncAt, storagePersisted, storageUsedRatio, now,
}) => { level: 'ok' | 'pending' | 'reminder' | 'warning' | 'critical', reasons: string[] }
```

| Level | When (any one condition) | What the user sees |
| --- | --- | --- |
| `ok` | outbox empty, no errors | Small green tick in the header |
| `pending` | outbox has entries, oldest < 30 min | Amber badge with unsynced count; tap opens the Sync screen |
| `reminder` | every **25 unsynced sales** since the last reminder, or oldest unsynced entry ≥ **2 h** | Dismissible toast: "25 sales not synced. Connect to internet and tap Sync now." Shown after the sale completes (on the receipt screen), never during cart entry. At most once per 30 min. |
| `warning` | oldest unsynced ≥ **12 h**, or unsynced sales ≥ **100**, or storage not persisted with any unsynced data, or storage used ≥ **80%** | Persistent amber banner on the sell screen with "Sync now". Cannot be dismissed until the condition clears. |
| `critical` | oldest unsynced ≥ **24 h**, or storage used ≥ **95%**, or any rejected entries (`errorCount > 0`) | Persistent red banner on every screen. Owner sees a "Needs review" list for rejected entries. Prompt to export a backup. |

Thresholds are constants in `syncHealth.ts`; a per-shop override can come later through shop settings (would need an architecture change — ask first).

### Notifications after transactions
- After each completed sale, khata payment, expense or refund: the outbox write triggers a debounced push (§4). If the device is offline, the receipt screen shows a small "Saved offline — will sync when online" line.
- The `reminder` toast (above) is evaluated after each completed transaction.
- When a push succeeds after being offline, show a short toast: "Synced 37 records".

### Guarded actions (warn or block before proceeding)
| Action | Behaviour if outbox is not empty |
| --- | --- |
| Logout / switch shop / unregister device | **Blocked.** Offer "Sync now"; if offline, allow only with owner PIN after a mandatory backup export. |
| Clear app data (in-app reset) | Same as logout. |
| Daily closing | Try to sync first. If offline, allow closing with a warning ("Closing offline — totals from other devices may be missing") and record it in the closing note. |
| App update reload | Allowed (data is in IndexedDB, not memory), but only when the cart is empty. |

### Server-side stale-device alert (Release 2)
A scheduled Edge Function checks `devices.last_sync_at`. If a device has not synced for 24 h, it notifies the owner by WhatsApp/SMS (once per day per device). Depends on the WhatsApp/SMS provider decision (§8).

### i18n
All sync messages go through `t()` with keys under `sync.*` in both `en.json` and `ur.json`. Counts use i18next plurals.

## 8. Key decisions still open
- Phone OTP provider (WhatsApp authentication template, SMS fallback) — deferred until business registration and Meta verification (§5).
- SMTP provider for email OTP (§5, deployment §3).
- Rider invite flow, and sign-in for riders without Google or email (§5).
- Cost price method on purchase: latest cost vs weighted average (US051).
- WhatsApp Business API provider (US058).
- Pricing and plans (pricing doc not yet decided).
- Whether devices report `storage_persisted` and outbox size to the server (would add columns to `devices`) so the owner/admin can see at-risk devices.
- Whether `sale_lines` also stores an Urdu name snapshot (`name_ur_snapshot`) so receipts can print in Urdu after a product is renamed.
