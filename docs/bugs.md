# NaqdPOS — bugs & UX notes

## Open

_Nothing open._

## Fixed

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
