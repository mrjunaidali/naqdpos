# NaqdPOS backlog

Epics → features → user stories (US###) with acceptance criteria. Claude Code implements one story at a time ("Implement US0xx", see CLAUDE.md).

- **Source:** the "ePOS Product Backlog" sheet (16 Nov 2026), updated 20 Nov 2026 for the own backend (Node + Hono, Postgres + RLS, Better Auth, S3/R2), Google/email sign-in, the NaqdPOS name, the produce presets and self-registration.
- **Rules win:** if a story disagrees with `docs/architecture.md` or a feature doc, the architecture/feature doc wins. Schema changes not in the architecture → stop and ask.
- **Releases:** R1 = MVP (fruit & veg pilot) · R2 = grocery & delivery · R3 = partners & billing.
- **Priority:** Must / Should / Could. **Points** are rough effort (1–8).
- **Status:** Done · Partly done · Next · To do · Proposed (decisions still open, don't build yet).

---

## Build order

Build in this order, not in ID order. "Sheet step" is the step number in the original sheet and in feature docs (e.g. expense steps 30a, 31…).

| # | Phase | Stories | Sheet step | Status |
| --- | --- | --- | --- | --- |
| 0 | Monorepo skeleton | — | 1 | Done (progress Step 0) |
| 1 | Tenancy + shop isolation | US007 | 2 | Done (Steps 1–3) |
| 2 | Installable PWA, layout, i18n base | US001, US002 | 3, 4 | Partly done (shell done; install step, storage persistence, nav layout open) |
| 3 | Owner sign-in, onboarding, device registration | US015, (US012 self-service part) | 6 | Done (Step 4) |
| 4 | **Sync engine** (outbox, push/pull, health, app version, update checks) | US003, US005, US006, US004 | 5, 17, 18, 19 | **Next** |
| 5 | Staff, PIN switch, permissions | US017, US016, US018 | 8, 9, 10 | Done (Step 6) |
| 6 | Products, categories, produce presets, today's rates | US019, US021, US072, US020 | 11, 12, —, 13 | To do |
| 7 | Selling: cart, custom item, cash, wallets/split | US029, US030, US034, US035 | 14, 15, 16, 20 | To do |
| 8 | Stock, wastage, discounts, FOC | US024, US025, US032, US033 | 21–24 | To do |
| 9 | Customers and khata | US038, US039, US040, US041 | 25–28 | To do |
| 10 | Shop profile and receipts | US014, US036 | 29, 30 | To do |
| 11 | Expenses | US065, US046, US066 | 30a, 31, 31a | To do |
| 12 | Daily closing | US044, US045, US067 | 32, 33, 33a | To do |
| 13 | Admin portal | US010, US011, US012, US013 | 34, 35, 7, 36 | To do |
| 14 | Reports | US047, US048, US049, US068 | 37, 38, 39, 39a | To do |
| 15 | Urdu complete, backups | US009, US008 | 40, 41 | To do |
| 16 | Self-registration and trial | US073–US077 | — | Proposed (see `docs/features/self-registration.md`) |
| — | **R1 pilot** | | | |
| 17 | Suppliers, purchases, payables | US050, US051, US052 | 42–44 | To do (R2) |
| 18 | Expense extras | US069, US070, US071 | 44a–44c | To do (R2) |
| 19 | Low stock, barcode, shared catalogue, combos | US026, US022, US023, US027, US028 | 45–49 | To do (R2) |
| 20 | Park cart, returns, credit limit, statement link | US031, US037, US042, US043 | 50–53 | To do (R2) |
| 21 | Daily khata WhatsApp | US058, US059 | 54, 55 | To do (R2) |
| 22 | Delivery and riders | US053–US057 | 56–60 | To do (R2) |
| 23 | Partners | US060, US061, US062 | 61–63 | To do (R3) |
| 24 | Plans and subscriptions | US063, US064 | 64, 65 | To do (R3) |

---

## E01 · Platform & offline sync (R1)

### F01 · PWA app shell

**US001** · Must · 3 · Partly done — As a shop owner, I want to install NaqdPOS on my phone's home screen or shop PC and open it like an app, so that I don't need the Play Store or a browser tab.
- Installable PWA (manifest, icons, splash) per architecture §6 — *done (Step 0)*
- Opens full-screen/standalone from the home screen or desktop — *done*
- Our own "Install app" button (`beforeinstallprompt`), iOS "Share → Add to Home Screen" guide, macOS Safari "Add to Dock" guide, Firefox desktop recommends Chrome/Edge
- `navigator.storage.persist()` on first run and each start until granted (Dexie `meta.storage_persisted`); one-time owner notice if not granted; `estimate()` on start and every 30 min
- Urdu font precached; app opens and completes a sale on first launch after install with the network off
- Loads in under 3 s on a mid-range Android after first visit

**US002** · Must · 5 · Partly done — As a cashier, I want screens that fit both a small phone and a desktop, so that I can sell on whatever device the shop has.
- Layouts work at 360px, 768px and 1280px widths; touch targets ≥ 44px
- Header with shop name, sync status slot and staff switch slot; bottom/floating nav on phones, side nav from 768px (look per `docs/design-theme.md`)
- Desktop keyboard shortcuts: `/` focuses search, F2 opens pay
- Theme tokens only (CSS variables), no hard-coded colours

### F02 · Offline data store

**US003** · Must · 8 · Next — As a cashier, I want to keep selling when the internet is down, so that no sale is lost.
- Every local write is one Dexie transaction: the row **and** its outbox entry (architecture §4)
- All sale screens work in airplane mode; data survives app close and phone restart
- Offline banner (`navigator.onLine` plus failed-request detection)
- Receipt screen shows "Saved offline — will sync when online" when offline

**US004** · Must · 3 · Next — As a shop owner, I want to see how many records are waiting to sync, so that I know my data is safe.
- `syncHealth()` in `packages/core` with the levels and thresholds of architecture §7 (incl. `updateRequired` → warning)
- Header badge: ok tick / pending count / warning / critical; last synced time; tap opens the Sync screen with "Sync now" and rejected entries (owner sees "Needs review")
- Reminder toast every 25 unsynced sales or after 2 h, only on the receipt screen, max once per 30 min
- Guarded actions (logout, reset, closing, update reload) behave as in §7
- Export backup / import backup (owner PIN) per §6

### F03 · Sync engine

**US005** · Must · 8 · Next — As a shop owner, I want offline records to upload automatically when internet returns, so that reports and khata are up to date on every device.
- `POST /sync/push` → SQL `sync_push`, batches of 200; append-only tables insert `ON CONFLICT DO NOTHING` (re-pushing never duplicates)
- Per-entry errors: a rejected entry (other shop, closed day) does not block the batch
- `GET /sync/pull` → SQL `sync_pull` by `server_seq` cursor until empty; device mode decides visibility (shop devices never get `product_costs` or `staff_salaries`)
- Triggers: app start, `online` event, after a write (debounced 5 s), every 60 s online, "Sync now"; backoff 5 s / 15 s / 60 s / 5 min; never blocks the UI
- Tables are registered in one place, so each new table only needs registering
- `devices.last_sync_at` and `last_seq_pulled` updated
- **App version (§4):** every request sends `X-App-Version`; with `MIN_APP_VERSION` set, old apps get `426 { min_version }`; the app pauses sync only (selling and outbox keep working), shows "Update required to sync — Reload" and runs the update check
- **Update checks (§6):** `registration.update()` every 60 min online and on visibility/focus; reload banner never while the cart has items

**US006** · Must · 8 · Next — As a shop owner using two devices, I want changes from both merged correctly, so that balances are never wrong.
- Stock and balances are sums of append-only movements, recomputed from ledgers
- Mutable rows (products, customers…): last write wins by `updated_at`; losers recorded in `sync_conflicts`, server keeps its version
- Integration test: two simulated devices sell and edit offline, then sync, and end with identical sums and the last-written product
- Conflicts visible to the system admin (admin route, later screen in US010)

### F04 · Multi-tenant backend

**US007** · Must · 5 · Done — As system admin, I want every shop's data isolated by shop ID, so that no shop can see another shop's data.
- `shop_id` on every table; RLS on every table; API connects as `naqdpos_app` (no `BYPASSRLS`)
- API rejects cross-shop access; Vitest RLS tests against `naqdpos_test` prove isolation

**US008** · Must · 3 · To do — As system admin, I want daily automatic backups, so that shop data can be restored after a failure.
- Nightly `pg_dump` by a worker job (pg-boss) to a separate R2 bucket, compressed; keep 30 daily + 12 monthly (deployment §5)
- Restore drill written in `docs/runbook.md` and tested once before the pilot (then monthly)

### F05 · Urdu/English language

**US009** · Should · 5 · To do — As a shopkeeper who reads Urdu better than English, I want to switch the app to Urdu, so that I can use it confidently.
- Language toggle in settings, saved on the device
- Every label from `en.json` / `ur.json`; all `TODO-ur` strings resolved (Junaid reviews Urdu)
- RTL layout checked on every screen; Rs amounts and numbers in Latin digits
- Product/category names show `name_ur` in Urdu, falling back to `name`

---

## E02 · Admin portal & onboarding (R1)

### F06 · Admin dashboard

**US010** · Must · 5 · To do — As system admin, I want a list of all shops with plan, status and last sync, so that I can support and manage them.
- `apps/admin` sign-in: Google + required TOTP 2FA; only `platform_admins`; `/admin/*` routes require a 2FA session
- Searchable list; filters: plan, status, city, shop type; shows last activity and last sync (from `devices`)
- Sync conflicts list (from US006)

**US011** · Should · 3 · To do — As system admin, I want to suspend or reactivate a shop, so that I can control access (e.g. unpaid plan).
- Suspended shop sees a notice and can view data but not sell; `sync_push` rejects new sales for suspended shops
- Action written to `audit_log` with `acting_as_admin = true`

### F07 · Setup on shop's behalf

**US012** · Must · 3 · To do (self-service part done in Step 4) — As system admin, I want to create a shop and invite its owner, so that I can onboard shopkeepers who can't do it themselves.
- Admin creates shop: name, type (fruit & veg, grocery, meat, general), address, phone
- Owner invited by email; the membership links when that email first signs in (Google or email OTP). Invite flow may need an `invites` table — **ask before adding** (architecture §8)
- Audit-logged

**US013** · Must · 5 · To do — As system admin, I want to add products and staff for a shop on its behalf, so that the shop is ready to sell on day one.
- "Act as shop" mode with a visible banner; every write audit-logged as admin
- Can use the fresh produce list (US072) and CSV import with preview and validation

### F08 · Shop profile

**US014** · Should · 2 · To do — As a shop owner, I want to set my shop name, address, phone, receipt footer and logo, so that receipts show my details.
- Editable shop profile; changes appear on the next receipt
- Logo uploaded through a pre-signed URL to object storage (key `logos/<shop_id>/…`, never a URL in the row), cached for offline use; `<BrandMark />` shows it

---

## E03 · Users, roles & access (R1)

### F09 · Login & staff PIN

**US015** · Must · 5 · Done (Step 4) — As a shop owner, I want to sign in without a password, so that login is easy and safe.
- Sign in with Google (shown when keys are set) or a 6-digit email code
- Session 90 days, works offline, sign-in only on a new device or after logout
- Still open: sign-out UI in settings (guarded by sync, §7); test Google sign-in in the installed PWA on iOS; phone OTP deferred (§5)

**US016** · Must · 3 · Done — As a cashier, I want to switch to my profile with a 4-digit PIN on the shared shop device, so that sales are recorded under my name.
- Quick switch from the header; PIN verified offline against the synced `pin_hash`
- After 5 wrong tries lock for 1 minute, then 5 minutes, then 15 minutes for every further lockout; a correct PIN resets it
- Current staff in Zustand; repository helpers stamp `staff_id` on every ledger write

### F10 · Roles & permissions

**US017** · Must · 3 · Done — As a shop owner, I want to add staff and give each a role, so that each person only sees what they need.
- Add, edit, deactivate staff; roles Owner, Cashier, Rider; 4-digit PIN hashed (PBKDF2, `packages/core/pin.ts`)
- Saved via Dexie + outbox; deactivated staff cannot switch in with their PIN

**US018** · Must · 3 · Done (own-shift sales and the `product_costs` check arrive with sales and products) — As a shop owner, I want cashiers not to see total sales, profit or cost prices, so that my figures stay private.
- `permissions.ts` `can(role, action)` with tests; cost price and reports hidden for cashiers
- Cashier sees only their own current-shift sales
- Enforced in API routes and RLS / `sync_pull`, not only the UI (test: a shop device never receives `product_costs`)
- Also resolve the open follow-up: riders must not receive other staff's `pin_hash` (progress Step 1)

---

## E04 · Catalogue & stock

### F11 · Product management (R1)

**US019** · Must · 5 · To do — As a shop owner, I want to add a product with name (English and Urdu), unit, sale price and cost price, so that I can sell and track profit.
- Name and unit and sale price required; `name_ur` and cost optional; units kg, g, dozen, piece, bundle, litre
- Prices entered in rupees, stored as paisa; cost saved to owner-only `product_costs`
- Decimal quantities for kg/litre; quick price edit from the list; `price_history` row on every price change
- Varieties are separate products

**US020** · Must · 3 · To do — As a shop owner, I want to update today's prices on one screen, so that I keep up with daily mandi rates.
- Bulk list with editable sale price (and cost for owners); "Save all" in one Dexie transaction with `price_history` rows; works offline

**US072** · Must · 3 · To do — As a fruit & veg owner, I want to pick my products from a ready-made list, so that I don't type potato, onion, tomato on every new shop. (Spec: `docs/features/produce-presets.md`.)
- Checklist of the 83 presets grouped by category (varieties together), in onboarding for `fruit_veg` shops and under Products → "Add from list"
- Ticking items and Save creates one `products` row each (`name` + `name_ur`) plus the needed categories, in one Dexie transaction with outbox entries, offline
- Optional today's rate per item → `sale_price_paisa` + `price_history`; blank → 0 and a rate prompt on first sale
- Items whose English name already exists show "Added" and are not created twice
- Search matches English, Urdu and Roman Urdu ("aalu", "آلو", "potato" → Potato; "chaunsa" → Mango (Chaunsa))

### F13 · Categories (R1)

**US021** · Must · 2 · To do — As a shop owner, I want to group products into categories, so that the cashier finds items faster.
- Create, rename (English and Urdu), reorder categories
- Reusable `CategoryTabs` component for the sale screen

### F14 · Stock tracking

**US024** · Must · 3 · R1 · To do — As a shop owner, I want stock to reduce automatically when I sell, so that I know what's left.
- Sale writes `stock_movements` (reason `sale`) in the same transaction for products with `track_stock`
- Stock = sum of movements (core function); shown in the product list; tracking can be switched off per product (e.g. loose herbs)

**US025** · Must · 3 · R1 · To do — As a shop owner, I want to record wastage and stock adjustments, so that stock and profit stay accurate for perishables.
- Reasons: spoiled (`wastage`), damaged, count correction; quantity and cost value (cost only on owner devices)
- Shows in daily and monthly reports

**US026** · Could · 2 · R2 · To do — As a shop owner, I want low-stock alerts, so that I reorder in time.
- `min_qty_milli` per product; low-stock list on the home screen

### F12 · Barcode & shared catalogue (R2)

**US022** · Should · 5 · To do — As a cashier, I want to scan a barcode with the camera or a scanner, so that I add packaged items fast.
- Camera scanning in the browser (library such as `@zxing/browser` — ask before adding); keyboard-wedge scanners on the sale screen
- Unknown barcode prompts to create the product

**US023** · Should · 5 · To do — As a shop owner, when I scan a barcode another shop already named, I want the name filled in, so that I don't type it.
- `global_catalogue` lookup by barcode (online; manual offline); each shop sets its own price
- New names saved as pending; admin approves them in `apps/admin`

### F15 · Combo products (R2)

**US027** · Should · 5 · To do — As a shop owner, I want a combo (e.g. fruit basket) from set items and quantities plus packaging cost, so that I sell it as one product.
- Combo = `combo_items` × quantities + `packaging_cost_paisa`; cost calculated in core; own sale price

**US028** · Should · 3 · To do — As a cashier, I want selling a combo to reduce stock of each item inside it.
- `stock_movements` reason `combo_component` = item qty × combos sold; returning a combo restores them

---

## E05 · Sales & checkout

### F16 · Quick sale

**US029** · Must · 8 · R1 · To do — As a cashier, I want to tap or search products and enter quantity or weight, so that I serve customers fast.
- Product grid with category tabs and search (English, Urdu, Roman Urdu)
- Keypad with decimals for kg/litre; "by amount" mode turns rupees into `qty_milli` (nearest 5 g for kg, whole units otherwise)
- Edit or remove lines; totals from a pure `cartTotals()` in core; cart in Zustand until payment
- Product with rate 0 asks for today's rate on first sale (US072)

**US030** · Should · 2 · R1 · To do — As a cashier, I want to add an item that isn't in the list, so that I never block a sale.
- "Custom item" with name, price, qty → line with `product_id` null and name snapshot; flagged in reports

**US031** · Could · 3 · R2 · To do — As a cashier, I want to park a cart and serve the next customer.
- Hold several carts and resume any; parked carts kept in Dexie (not synced), survive refresh

### F17 · Discounts & free items (R1)

**US032** · Must · 3 · To do — As a cashier, I want to give a discount on an item or the whole bill (Rs or %), so that I can handle bargaining.
- Line and bill discounts; owner sets the cashier's maximum discount % (owner unlimited), enforced in core
- Shown on receipt and in reports

**US033** · Should · 3 · To do — As a cashier, I want to add free items (mint, coriander, chillies with sabzi), so that stock reduces but the customer isn't charged.
- FOC line at Rs 0 (`is_foc`), value at sale price kept for reporting, stock reduced
- Optional `foc_rule` per product shown as a one-tap suggestion; presets mark usual FOC items

### F18 · Payments (R1)

**US034** · Must · 2 · To do — As a cashier, I want to take cash and see the change due, and complete the sale.
- Tendered amount, change from core; quick buttons Rs 100 / 500 / 1000 / 5000
- On confirm: `sales`, `sale_lines`, `payments` in one Dexie transaction with outbox entries; `receipt_no` = device code + per-device counter; `business_date` in Asia/Karachi; blocked if the day is closed
- Cart cleared; receipt/success screen (reminder toast lives here, §7)

**US035** · Must · 3 · To do — As a cashier, I want to record JazzCash, Easypaisa, bank or split payments, so that closing matches each method.
- `payment_methods` per shop (seed cash, JazzCash, Easypaisa, bank); owner enables, disables, adds
- Split a bill across methods with remaining amount shown; optional reference number

### F19 · Receipts (R1)

**US036** · Should · 5 · To do — As a cashier, I want to share the receipt on WhatsApp or print it, so that the customer has proof.
- Receipt from shop profile, lines, discounts, FOC, payments, khata balance if a customer is attached
- WhatsApp share (`wa.me` text); Bluetooth ESC/POS 58 mm and 80 mm with browser print fallback; "No receipt" option

### F20 · Returns (R2)

**US037** · Should · 5 · To do — As a cashier, I want to return items from a past sale, so that I can refund or credit the customer.
- Find sale by receipt no. or customer; partial returns
- Refund by cash (`payments` kind `refund`) or khata credit (`return_credit`); stock back (`return`) or marked as wastage
- Optional owner PIN approval

---

## E06 · Customers & khata

### F21 · Customer lookup (R1)

**US038** · Must · 3 · To do — As a cashier, I want to attach a customer to any sale by mobile number, so that their purchases and balance are tracked.
- Search or create by mobile (normalised to +92 with `phone.ts`); name optional; unique per shop; works offline

### F22 · Khata ledger

**US039** · Must · 3 · R1 · To do — As a cashier, I want to put all or part of a bill on the customer's khata, so that regulars can pay later.
- Needs a customer; unpaid amount → `khata_entries` `credit_sale`; balance via core, shown when the customer is picked; offline

**US040** · Must · 3 · R1 · To do — As a shop owner, I want to record a payment from a khata customer, so that their balance goes down.
- Amount, method, date → `payments` (`khata_receipt`) + `khata_entries` (`payment`, negative); shareable WhatsApp receipt text; offline

**US041** · Must · 3 · R1 · To do — As a shop owner, I want khata customers sorted by highest balance, so that I know who to follow up.
- Total receivable; overdue filter (oldest unpaid credit older than X days); call (`tel:`) and WhatsApp (`wa.me`) buttons; customer ledger page

**US042** · Could · 2 · R2 · To do — As a shop owner, I want a credit limit per customer, so that I don't over-lend.
- Warning on the pay screen when khata would exceed it; owner PIN to override

### F23 · Customer statement link (R2)

**US043** · Should · 3 · To do — As a khata customer, I want a link to see my transactions and balance, so that I can trust the shop's record.
- Tokenised read-only public page (token stored hashed, revocable); dated entries and running balance
- Served by an API route calling a SQL function that only accepts the token

---

## E07 · Closing & reports

### F24 · Daily closing (R1)

**US044** · Must · 8 · To do — As a shop owner, I want to close the day by counting cash against expected cash, so that I catch shortages.
- Opening cash defaults to yesterday's counted cash (editable); expected cash from core `expectedCash()` (architecture §3 formula), same result in SQL (shared fixture)
- Counted cash with a denomination helper; difference and note; `day_closes` row
- After closing, no ledger writes for that `business_date` on the device or in `sync_push`
- Tries to sync first; offline closing allowed with a warning recorded in the note (§7)

**US045** · Must · 5 · To do — As a shop owner, I want a daily summary, so that I understand the day at a glance.
- Sales by method, discounts, FOC value, khata given and received, expenses, wastage, cash difference
- Share as WhatsApp text or printable/PDF view

### F38 · Expense management (R1 + R2) — spec: `docs/features/expense-management.md`

**US065** · Must · 3 · R1 · To do (EXP-2) — Expense categories: defaults per shop type (fruit & veg: Mandi transport, Rent, Bijli/gas, Staff salary, Staff advance, Petrol, Shopping bags, Wastage, Other); owner adds, renames, reorders, archives; defaults via i18n keys. Includes the expense schema migration + Dexie bump.

**US046** · Must · 3 · R1 · To do (EXP-1) — Record an expense offline: category, amount > 0, method, optional note/payee; one row + outbox entry; cashier above `cashier_expense_limit_paisa` needs owner PIN (`approved_by_staff_id`); blocked on a closed day; riders cannot add.

**US066** · Should · 3 · R1 · To do (EXP-3) — Reverse a wrong expense (owner only): reason, negative row with `reverses_expense_id`, once only, dated today if the original day is closed.

**US067** · Must · 2 · R1 · To do (EXP-4) — Expenses in closing: expected cash subtracts cash expenses net of reversals and the owner withdrawal; closing lists expenses by category; WhatsApp summary includes total expenses.

**US068** · Should · 5 · R1 · To do (EXP-5) — Expense list with filters and total; monthly view by category vs last month; lines in the monthly P&L; CSV for owners; cashiers see only their own entries for today.

**US069** · Could · 3 · R2 · To do (EXP-6) — Bill photo: compress to ~300 KB, keep locally, upload via pre-signed URL to `bill-photos/<shop_id>/<expense_id>.jpg`, then write an `expense_attachments` row; saving never waits for upload.

**US070** · Should · 5 · R2 · To do (EXP-7) — Recurring expenses: template, reminder on the due date with Record or Skip, never automatic, linked by `recurring_expense_id`.

**US071** · Should · 5 · R2 · To do (EXP-8) — Staff advances and salary: `payee_staff_id` required; advances this month on the staff page; salary suggestion = `staff_salaries.monthly_salary_paisa` − advances.

### F25 · Monthly closing (R1)

**US047** · Must · 5 · To do — As a shop owner, I want a monthly close with sales, cost, gross profit, expenses and receivables, so that I know if I made money.
- Built from locked daily closes; cost at time of sale (`price_history` / `product_costs`); wastage value; receivables at month end
- Owner-only API report (SQL function); CSV and printable/PDF; adds payables once E08 is live

### F26 · Owner reports (R1)

**US048** · Should · 5 · To do — As a shop owner, I want a dashboard with today's sales, top items and khata due, so that I can check my shop from anywhere.
- Owner only; data from an owner-only report route; last result cached for offline viewing; date range filter
- Home screen layout per `docs/design-theme.md` (hero card, stat cards, action tiles, recent list)

**US049** · Should · 3 · To do — As a shop owner, I want sales by product and by staff for any date range.
- Qty, value and profit per product; sales per staff; custom items flagged; CSV export; owner-only routes

---

## E08 · Suppliers & payables (R2)

**US050** · Must · 2 · To do — Suppliers (mandi arhti, distributor): add, edit, deactivate; name and phone required. New migration + Dexie bump.

**US051** · Must · 5 · To do — Record a purchase (supplier, items, qty, cost, bill photo): `purchases`, `purchase_lines`, `stock_movements` (`purchase`), `supplier_ledger` in one transaction; updates `product_costs`. **First ask which cost method (latest vs weighted average)** (architecture §8).

**US052** · Must · 3 · To do — Supplier payables: balance per supplier, partial payments (`payments` kind `supplier_payment`); cash payments reduce expected cash (update core and tests).

---

## E09 · Delivery & riders (R2)

**US053** · Must · 5 · To do — Delivery orders: `order_type` delivery, address on the customer, assign a staff rider, `deliveries` status New → Out → Delivered / Cancelled with history.

**US054** · Must · 3 · To do — Rider view: rider device mode (§4/§5; rider sign-in flow still open) shows only assigned active deliveries (RLS + `sync_pull` scoping, tests); call and open-in-maps; no access to other sales.

**US055** · Must · 3 · To do — Rider marks delivered (timestamp) and records collection as cash, khata or already paid; offline.

**US056** · Must · 2 · To do — Rider sees running total of cash collected and not yet handed over (core function).

**US057** · Must · 3 · To do — Cashier confirms cash from a rider (`payments` kind `rider_handover`); shortfall flagged; included in expected cash (update core and tests).

---

## E10 · WhatsApp notifications (R2)

**US058** · Must · 5 · To do — One WhatsApp message per khata customer per day, only on days with a khata transaction: scheduled worker job (pg-boss) at shop day-end, approved template with balance + statement link (US043), logged in `message_log`. **First ask which WhatsApp Business API provider** (architecture §8).

**US059** · Should · 2 · To do — Per-customer `whatsapp_opt_in` toggle and a shop-wide on/off, respected by US058.

---

## E11 · Delivery partners (R3)

**US060** · Should · 3 · To do — Order source per shop (walk-in, phone, Foodpanda…); Foodpanda orders "paid by partner", no rider.

**US061** · Should · 5 · To do — Partner receivable ledger, optional commission %, settlement entries, report of what each partner owes.

**US062** · Could · 3 · To do — Dispatch a delivery via InDrive or Bykea; delivery charge recorded as an expense or added to the bill; status updated manually.

---

## E12 · Plans & billing (R3)

**US063** · Should · 5 · To do — Plans with limits (devices, staff, features) enforced in the API/SQL and the app; admin assigns plans. Pricing not decided yet.

**US064** · Should · 8 · To do — Plan and renewal date in shop settings, reminders, grace period (never blocks selling or loses data), JazzCash/Easypaisa payment (ask which gateway), admin manual payment entry.

---

## E13 · Self-registration & trial (Proposed) — spec: `docs/features/self-registration.md`

Don't build until the open decisions in that doc are made (open vs approved sign-up, trial length, payment, legal pages). Schema needs (trial/source fields) must be approved first.

**US073** · Should · 3 · Proposed — Sign-up entry from the website: `/signup?lang=&ref=&utm_*` carries language and source through sign-in into shop creation.

**US074** · Should · 3 · Proposed — Shop details at sign-up: name, type, city, owner name, mobile (unverified), optional referral code; terms/privacy acceptance.

**US075** · Should · 5 · Proposed — Guided first setup: product picking (US072 for fruit & veg), install step and storage persistence (US001), "Try a test sale", and "Help me set up" WhatsApp button with the shop name.

**US076** · Should · 3 · Proposed — Free trial status: days left shown to owners, reminders at 7/3/1 days; trial end never blocks selling or loses data.

**US077** · Should · 5 · Proposed — Admin sign-up list (source, step reached, last sync, never-sold follow-up list), new sign-up notification to the team, admin extends trial / changes plan (audit-logged); rate limits on auth and `POST /shops`.
