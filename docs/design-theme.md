# NaqdPOS — visual theme

Decided: 19–20 Nov 2026 (Junaid). Professional, pleasant, corporate look in **black, white and grey**. Accent: **near-black primary** (monochrome). Home screen direction (20 Nov): black hero card with today's sales + 7-day trend + sync chip, two small stat cards, a row of four action tiles, a "Recent" list, and a floating black nav bar with a white "Sale" pill. Not a copy of the earlier blue screens.

## Look
- Page background: light grey (`zinc-100`).
- Cards: white, thin `zinc-200` border, rounded corners (~14–18px), no shadow.
- Hero card: near-black (`zinc-900`) with white text and grey secondary text.
- Text: near-black titles and numbers (`zinc-900`), grey labels (`zinc-500`).
- Icons: outline icons, consistent stroke width.
- Font: Inter or system UI; large figures for key numbers.
- Touch targets ≥ 44px (CLAUDE.md).

## Colour use
- **Primary** (main buttons, nav bar, hero card, active state): near-black with white text.
- **Secondary buttons:** white with grey border and dark text.
- Colour only where it carries meaning: green = success/synced, amber = pending/warning, red = critical/errors/destructive.

## Implementation (must support branding later — see below)
- **All colours are CSS variables** (e.g. `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-muted`, `--color-primary`, `--color-primary-fg`, `--color-hero`, `--color-success`, `--color-warning`, `--color-danger`). Tailwind's theme maps its colour names to these variables (`primary: 'rgb(var(--color-primary) / <alpha-value>)'`).
- Components use only these token names (`bg-primary`, `text-muted`…). **No raw hex values and no fixed palette classes (`bg-zinc-900`, `bg-blue-600`) in components.** Default values live in one CSS file (`apps/pos/src/theme/default.css`).
- The logo/brand mark is one component (`<BrandMark />`) that shows the shop logo if set, otherwise the NaqdPOS mark.
- App name shown in the UI comes from one place (i18n key `app.name`), never typed into components.
- Same approach in `apps/pos` and `apps/admin`.
- Dark mode: not now; the variables make it possible later.

## Branding per client (future paid feature — not built now)

Goal: sell custom branding to shops/chains. The architecture must allow it without rewriting UI code.

### Levels
1. **Shop branding (in-app):** shop logo, primary/hero colour, receipt header/footer. Applied at runtime after login by setting the CSS variables from shop settings. Works offline (settings and logo cached on the device).
2. **White label (bigger clients):** own app name, icons, splash colours and their own domain (e.g. `pos.clientshop.pk`). Needs a per-domain web manifest and icons, served based on the request's host. Plan when the first client asks.

### What this needs later (ask before adding — architecture rule 8)
- Shop settings for branding, e.g. a `shop_branding` table or `shops` columns: `primary_color`, `hero_color`, `logo_path` (already exists), `app_display_name` null. Synced to devices like other shop settings.
- A plan/feature flag so only paying shops can set it (fits the future `plans` / `subscriptions` tables).
- Contrast check when an owner picks a colour (text on primary must stay readable); fall back to the default theme if it fails.
- For white label: a `custom_domains` mapping and a small manifest endpoint; `APP_ORIGINS` / CORS must accept those domains.

### Rules that keep this possible now
- Tokens only, no hard-coded colours (above).
- Logo by storage key, never by URL (CLAUDE.md portability rule 5).
- No brand name, colour or logo baked into images or icons used inside the app UI.
- Receipts read shop name, logo and footer from shop settings (already in `shops`).
