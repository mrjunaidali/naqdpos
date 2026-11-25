# NaqdPOS — bugs & UX notes

## Open

_Nothing open._

## Fixed

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
