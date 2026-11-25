# Feature: Offer flyer (PDF)

Status: **proposed** (idea from Junaid, 22 Nov 2026). In backlog as **US081** (E14, Proposed). Don't build until the open decisions below are made.

## Goal

A shop owner makes a simple, good-looking offer flyer in a few taps and sends it to customers (WhatsApp, print). He picks the offer dates and the items; the app lays out the flyer for him. No design skills needed.

## Proposed flow

1. Products → **"Make offer flyer"** (owner only).
2. **Dates:** flyer date (defaults to today), **offer start date** and **offer end date** (end ≥ start). The dates are printed on the flyer ("Offer valid 25–30 Nov").
3. **Pick items** from the shop's products (search, category chips, same grid as the sale screen). For each item: offer price (defaults to today's sale price); optional "was" price shown struck through.
4. Optional headline (e.g. "Weekend offer", "Mango season") from a few presets or typed.
5. **Language:** English, Urdu or both.
6. **Preview → Share / Download / Print.** Share uses the device share sheet (Web Share API with a file) so it goes straight to WhatsApp; falls back to download.

## Flyer content

- Shop logo (`<BrandMark />` source) or name, address, phone/WhatsApp number (from shop profile, US014).
- Headline, offer validity dates.
- Item list or grid: product icon (emoji, US078), name (current language, or both), unit, offer price per unit, optional old price.
- Footer: shop receipt footer text; small "Made with NaqdPOS" line (open — could be removable on paid plans, see branding in `design-theme.md`).
- Size: A4 portrait for print, plus a phone-friendly shape for WhatsApp.

## Rules

- **Works offline.** The flyer is generated on the device from Dexie data; no server call needed.
- Owner only (`can(role, 'makeFlyer')`); cashiers and riders don't see it.
- Money in paisa internally, shown as `Rs 160/kg`; dates in `Asia/Karachi`.
- Theme tokens and shop branding, no hard-coded colours (design-theme.md).
- All labels through `t()` in `en.json` and `ur.json`.

## Technical notes

- Needs a PDF/image library — **ask before adding** (CLAUDE.md). Options: render the flyer as HTML/canvas and export (keeps Urdu Nastaliq shaping correct, since many PDF libraries don't shape Urdu), or a PDF library such as `pdf-lib` with an embedded image of the layout.
- The Urdu font is already precached (architecture §6), so Urdu flyers work offline.
- WhatsApp shows images inline but PDFs as attachments — consider offering **image (PNG/JPG) as well as PDF**.

## Decisions open

- [ ] **Flyer only, or a real offer?** Does the offer price apply at the till automatically between start and end date? Flyer-only needs no schema change. A real offer needs a new `offers` / `offer_items` table (synced, owner-written) and pricing logic in `packages/core` — architecture change, ask first.
- [ ] Save flyers to reuse/edit later (needs storage, local or synced) or generate fresh each time?
- [ ] What the "date" field means if not the flyer issue date.
- [ ] PDF only, or image too (recommended for WhatsApp)?
- [ ] Send to khata customers directly (bulk WhatsApp needs the WhatsApp Business API, US058, and opt-in, US059) or only share manually?
- [ ] A few templates/colour styles, or one fixed layout at first?
- [ ] "Made with NaqdPOS" footer: always, or removable on paid plans?
- [ ] Release (suggested R2, after the pilot).

## Out of scope (for now)

Coupon codes, loyalty points, automatic scheduled sending, printed-shop delivery of flyers.
