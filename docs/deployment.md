# NaqdPOS hosting and deployment

Status: **decided (Nov 2026)**. Front ends on Railway, backend on Supabase Cloud (project `naqdpos`). Start on Supabase Free, move to Pro when paying shops cover it.

## 1. What runs where

| Part | What it is | Host |
| --- | --- | --- |
| `apps/pos` | Static PWA (Vite build output) | Railway, `pos.<domain>` |
| `apps/admin` | Static SPA (Vite build output) | Railway, `admin.<domain>` |
| Backend | Postgres + RLS, Auth (Google sign-in, email OTP, TOTP for admins), Storage (bill photos, logos), Edge Functions, scheduled jobs | Supabase Cloud, region closest to Pakistan (e.g. Mumbai) |
| Email for OTP | SMTP provider connected to Supabase Auth (free tier, e.g. Resend or Brevo) | Still open (architecture §8) |
| Phone OTP (later) | WhatsApp authentication template, SMS fallback | Deferred until business registration and Meta verification (architecture §5) |

The shop app is offline-first, so the distance between Pakistan and the server matters less than usual. Sync tolerates latency.

## 2. Static hosting requirements (Railway)

Both apps run as a small static web server (Caddy or nginx) per Railway service.

- **HTTPS only**, with a custom domain (Railway provides the certificate). Service workers need HTTPS.
- **SPA fallback**: every unknown path returns `index.html` (React Router).
- **Cache headers**:
  - `index.html`, `sw.js`, `manifest.webmanifest`, `registerSW.js`: `Cache-Control: no-cache`. Otherwise the "New version available" prompt never appears (architecture §6).
  - `/assets/*` (hashed): `Cache-Control: public, max-age=31536000, immutable`.
- **MIME**: `.webmanifest` → `application/manifest+json`.
- **Build-time env**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key). **Never** put the service role / secret key in a front-end build.

Example `Caddyfile`:

```
:{$PORT} {
	root * /srv
	encode gzip zstd

	@nocache path /index.html /sw.js /registerSW.js /manifest.webmanifest
	header @nocache Cache-Control "no-cache"

	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"

	@manifest path *.webmanifest
	header @manifest Content-Type "application/manifest+json"

	try_files {path} /index.html
	file_server
}
```

## 3. Supabase setup

- **Projects**:
  - `naqdpos` — created Nov 2026 (Free plan). Production.
  - `naqdpos-staging` — to create when needed (Free allows 2 projects). Until then, develop locally with the Supabase CLI (`supabase start`, needs Docker).
  - Migrations in `supabase/migrations/` are applied with the Supabase CLI (`supabase link` then `supabase db push`) from CI, staging first.
- **RLS**: available on every plan; nothing to enable at account level. Every migration that creates a table must also `enable row level security` and add policies (tables created by SQL don't get RLS automatically). Check the dashboard Security Advisor after each migration.
- **Auth** (architecture §5):
  - **Google**: create an OAuth client in Google Cloud (consent screen with app name, logo and privacy policy URL; scopes `email` and `profile` only). Add the Supabase callback URL and the `pos.` and `admin.` domains as redirect URLs. One client per Supabase project.
  - **Email OTP**: enable the Email provider with a typed 6-digit code (edit the email template to show `{{ .Token }}`, not a magic link). Connect a custom SMTP provider; the built-in mailer is rate-limited and for testing only. Send from an address on our domain (set up SPF/DKIM so codes don't land in spam).
  - **MFA**: enable TOTP; the admin portal requires AAL2 for platform admins.
  - Confirm identity linking so Google and email OTP with the same email give one user.
  - Phone provider stays **off** until phone OTP is added.
  - Development: use test Google accounts and test email addresses; set auth rate limits.
- **Storage**: bucket `bill-photos` (private, RLS by `shop_id`), bucket `logos`.
- **Secrets**: service role key only in Edge Functions and CI, never in apps. Keep the database password in a password manager.

## 4. Cost plan

Prices checked Nov 2026; PKR at roughly Rs 280 = $1.

| Stage | Supabase | Approx. monthly |
| --- | --- | --- |
| Build + pilot (first few shops) | Free plan: 500 MB DB, 50K MAU, 2 projects, no automatic backups, pauses after 7 days of **no activity** | Rs 0 |
| Paying shops | Pro: $25/org incl. $10 compute credit (one Micro project). 8 GB DB, 100K MAU, 250 GB bandwidth, daily backups (7 days), no pausing | ~Rs 7,000 |
| Pro + staging on Pro | $25 + $10 extra Micro project | ~Rs 9,800 |

Plus: Railway usage for the two static services (Hobby plan, $5/month minimum that is credited as usage, ~Rs 1,400), the domain, and the SMTP provider (free tier covers pilot volume). No SMS cost while sign-in is Google + email OTP. When phone OTP is added: WhatsApp authentication messages are about Rs 3 each; international SMS APIs are about Rs 72–133 each.

**Break-even**: at Rs 1,000–1,500 per shop per month, 5–7 shops cover Supabase Pro.

### Free-plan rules while piloting
- Daily syncing from real shops keeps the project active, so it does not pause.
- Free has **no automatic backups**: run a nightly `pg_dump` (e.g. a scheduled GitHub Actions job) and keep the dump in private storage. Test a restore once.
- Upgrade Free → Pro is a plan change in the dashboard; no data migration.

## 5. Alternative considered: no Supabase

Railway Postgres + own Node API (Hono/Fastify) + own phone OTP/JWT + S3-compatible storage (e.g. Cloudflare R2) + Railway cron. Feasible because sync and reports are already Postgres functions, but adds an estimated 2–4 weeks of work (auth and security are the risky parts) and makes us responsible for backups and patching. Railway itself is usage-billed, so savings would be partial. **Not chosen for now**; revisit if Supabase cost becomes a problem at scale. Switching later is possible because the data is plain Postgres.

## 6. Open items
- SMTP provider for email OTP (architecture §8).
- Phone OTP provider — deferred until business registration and Meta verification.
- Test Google sign-in inside the installed PWA on iOS (architecture §5).
- Domain name.
- Off-site backup location for the nightly dump during the Free stage.
