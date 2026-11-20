# Feature: Self-registration for shops (clients)

Status: **planning** (20 Nov 2026). In backlog as **US073–US077** (E13, Proposed). Not built beyond what already exists. Linked from `docs/marketing-website.md` (the "Start free trial" button).

## Goal

A shop owner finds NaqdPOS (website, WhatsApp, a friend), signs up **on their own**, and is selling within ~5 minutes — no call with us needed. Assisted setup (we add products for them) stays available as an option, not a requirement.

## What already exists (next-steps.md, 19 Nov)

- Owner sign-in with email OTP (Google ready, off until keys exist).
- Onboarding: create shop, owner staff + PIN (`POST /shops`).
- Device registration (A1, A2…).

So the core is in place. Self-registration adds the **entry from the website, trial/plan status, guided first setup and admin visibility**.

## Proposed flow

1. **Website** → "Start free trial" → `pos.<domain>/signup?lang=ur|en&ref=<code>&utm_*`. Language carries over from the page they came from.
2. **Sign in**: Google or email OTP (architecture §5). Short Urdu/English explanation of why we need email.
3. **Shop details**: shop name, shop type (`fruit_veg` | `grocery` | `meat` | `general`), city, owner name, **mobile number** (profile data, not login), optional referral/partner code.
4. **Owner PIN** (4 digits).
5. **Pick products**: fruit & veg → preset checklist with today's rates (`produce-presets.md`); other types → skip for now / add manually.
6. **Install the app** step (Android install button / iOS "Add to Home Screen" guide) and storage persistence request (architecture §6).
7. **First sale prompt** ("Try a test sale") → home screen.
8. Optional at any step: **"Help me set up"** → opens WhatsApp with a pre-filled message including the shop name, so our team can add products/staff through the admin portal.

Everything after sign-in should also work if the connection drops mid-way, except steps that need the server (sign-in, creating the shop). Product picking is a normal offline write.

## Trial and plans

- New shop starts on a **free trial** (length open — see pricing).
- Show trial days left to the owner (not cashiers); reminders at e.g. 7, 3, 1 days left.
- **Trial end must never block selling or lose data** (rule 1, offline first). Options: read-only reports + nag banner, or keep selling with a banner until paid. Decide with pricing.
- Payment collection (JazzCash/Easypaisa/bank transfer, manual at first) — open.

## Admin side (`apps/admin`)

- List of new sign-ups: shop, type, city, mobile, signup date, source/ref, last sync, onboarding step reached.
- Notify the team on each new sign-up (email or WhatsApp to us) so we can call and help.
- Spot shops that signed up but never sold → follow-up list.
- Admin can extend trial, change plan, suspend (audit-logged, architecture §5).

## Abuse and safety

- Email must be verified (OTP / Google) before a shop is created.
- Rate-limit sign-up and OTP endpoints per IP and per email.
- One email can own several shops (chains) — allowed, but visible to admin.
- Phone number not verified at launch (phone OTP deferred); mark it as unverified.
- No CAPTCHA at first; add a privacy-friendly one only if spam appears.

## Schema needs (ask before adding — architecture rule 8)

Not yet in `docs/architecture.md`; propose when the story is written:
- Trial/plan state: uses the planned `plans` / `subscriptions` tables (Release 2+ list) or a simple `shops.trial_ends_at` for launch.
- Sign-up source: `shops.signup_source`, `shops.referral_code`, UTM fields (or a separate `signups` table).
- Onboarding progress: `shops.onboarding_step` or derived from data (has products? has a sale?). Derived is preferred — no new column.
- Partner/referral codes link to the future `partners` table.

## Decisions open

- [ ] Fully open sign-up, or approval by us before the shop goes live? (Suggested: open, with admin notification.)
- [ ] Trial length and what happens at trial end (with pricing).
- [ ] Is assisted setup free during trial?
- [ ] Which fields are required at sign-up (keep it short: shop name, type, mobile).
- [ ] Referral / partner codes at launch or later.
- [ ] How we take payment after trial.
- [ ] Terms + privacy acceptance at sign-up (checkbox or "By continuing you agree…" line) — needs the legal pages from the website plan.

## To-do

### Decide
- [ ] Items in "Decisions open" above.

### Write
- [x] Backlog stories (US073–US077 in `docs/backlog.md`); expand acceptance criteria once decisions are made.
- [ ] Architecture update for trial/source fields once approved.
- [ ] Urdu + English copy for every onboarding screen.

### Build (later)
- [ ] `/signup` route accepting `lang`, `ref`, `utm_*` and passing them through sign-in.
- [ ] Extend onboarding with city, mobile, referral, product picking, install step, test sale.
- [ ] Trial days-left banner and reminders.
- [ ] Admin sign-up list + new sign-up notification (worker job).
- [ ] Rate limiting on auth and `POST /shops`.
- [ ] End-to-end test (Playwright): website button → sign-up → first sale, offline after sign-in.
