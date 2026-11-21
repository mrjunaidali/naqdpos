# NaqdPOS hosting and deployment

Status: **decided (Nov 2026)**. Own backend on open standards: Node API + PostgreSQL + S3-compatible storage. Start on Railway + Cloudflare R2; every part can move to another host by changing environment variables. Supabase was evaluated and dropped (§6).

## 0. Brand and domains

- Brand: **Naqd** (local) / **NaqdPOS** (app stores).
- Registered (Nov 2026): **naqd.pk**, **naqdpos.pk**, **naqd.com.pk**.
- Not yet registered: naqdpos.com (free when checked 19 Nov 2026), naqd.com (for sale on Sedo, negotiate later), naqdly.com (possible future global brand).
- Open: which domain serves the apps (`pos.`, `admin.`, `api.` subdomains below). Suggested: naqd.pk, with the others forwarding to it.

## 1. What runs where

| Part | What it is | Start on | Can move to |
| --- | --- | --- | --- |
| `apps/pos` | Static PWA (Vite build) | Railway static service, `pos.<domain>` | Cloudflare Pages, Netlify, any web server |
| `apps/admin` | Static SPA (Vite build) | Railway static service, `admin.<domain>` | Same as above |
| `apps/api` (API) | Docker image, Node 24 + Hono | Railway service, `api.<domain>` | Render, Fly, any VPS, AWS/Azure container services |
| `apps/api` (worker) | Same image, worker entry (pg-boss jobs) | Railway service | Same as API |
| Database | PostgreSQL 17 | Railway Postgres | Neon, AWS RDS, DigitalOcean, own server |
| Files | S3-compatible object storage | Cloudflare R2 (no egress fees) | AWS S3, Backblaze B2, MinIO |
| Email (OTP codes) | SMTP | Free tier of Resend or Brevo (open) | Any SMTP provider |
| Phone OTP (later) | WhatsApp auth template, SMS fallback | Deferred until business registration and Meta verification | — |

Region: as close to Pakistan as the host offers. The shop app is offline-first, so latency matters less than usual.

## 2. Settings (environment variables)

Moving a part = changing its settings. Nothing host-specific is in code.

| Where | Variable | Example / note |
| --- | --- | --- |
| pos, admin (build time) | `VITE_API_URL` | `https://api.<domain>` (local: `http://localhost:8787`) |
| API, worker | `DATABASE_URL` | `postgres://naqdpos_app:…@host:5432/naqdpos` (app role, RLS applies) |
| API, worker | `DATABASE_ADMIN_URL` | owner role; migrations and backup jobs only |
| API, worker | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | R2 endpoint now |
| API | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | long random secret; public API URL |
| API | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client |
| API, worker | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | OTP emails |
| API | `APP_ORIGINS` | allowed front-end origins for CORS (`https://pos.<domain>,https://admin.<domain>`) |

Secrets live only in the host's secret settings and a password manager. Never in the repo, never in front-end builds. `.env.example` lists every variable without values.

## 3. Environments

| Env | Database | API | Front ends |
| --- | --- | --- | --- |
| Local | Postgres installed on the PC (`naqdpos_dev`, `naqdpos_test`); MinIO in Docker when files are needed | `pnpm --filter api dev` | `pnpm --filter pos dev` |
| Staging | separate Railway Postgres | Railway service from `main` | Railway, `staging-pos.<domain>` |
| Production | Railway Postgres | Railway service from release tags | Railway, `pos.<domain>` |

- **Offline first launch (check before each release):** `pnpm check:precache` builds the app and fails if the service worker does not precache the app shell, the Urdu font (both weights), the icons and the manifest (i18n is in the JS bundle). Then by hand: open the app once online, install it, sign in and register the device; turn the network off (airplane mode), close the app completely, open it from the home screen, and complete a cash sale. It must open, sell and show “Saved offline”.
- **Testing on a phone (Local, development only):** `pnpm dev:lan` starts the API and the POS dev server together and prints the phone address, `https://<PC's Wi-Fi IP>:5173`.
  - The dev server then listens on all interfaces with a self-signed HTTPS certificate (`@vitejs/plugin-basic-ssl`, dev dependency). Phones need a secure context for WebCrypto (PIN hashing), the service worker and `storage.persist()`.
  - The app calls the API through the dev server's `/api` proxy (`/api/*` → `http://localhost:8787`, prefix removed; all headers pass through). `dev:lan` sets `VITE_API_URL=/api`; on the dev server an empty or `/api` value means `<page origin>/api` (`apps/pos/src/api/baseUrl.ts`). The phone never calls `localhost`, there is no mixed content, and no CORS is needed because every call is same-origin. Only port 5173 is reachable from the phone.
  - The proxy presents the API's own origin to Better Auth, so the phone's LAN origin does not have to be added to `APP_ORIGINS`.
  - Steps: the phone joins the same Wi-Fi; open the printed address; accept the certificate warning once; sign in with an email code (printed by the API in development). If the phone cannot connect, allow port 5173 on Private networks once, from an admin PowerShell: `New-NetFirewallRule -DisplayName "NaqdPOS dev server (5173)" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private` (the Wi-Fi must be set to Private in Windows).
  - Nothing changes for builds: production uses `VITE_API_URL` exactly, CORS keeps `APP_ORIGINS`, and `pnpm dev` behaves as before.
- **Migrations:** `dbmate` with plain SQL in `db/migrations/`, run from CI against staging first, then production (`DATABASE_ADMIN_URL`). The database must always be rebuildable from migrations.
- **CI (GitHub Actions):** on every push: install, lint, typecheck, unit tests, and API/RLS tests against a Postgres service container. On merge to `main`: build Docker image, migrate staging, deploy staging. Production on tag.
- **Database roles:** created by the first migration: owner role (migrations), `naqdpos_app` (API; no `BYPASSRLS`, owns nothing).

## 4. Static hosting requirements (front ends)

- **HTTPS only**, custom domain. Service workers need HTTPS.
- **SPA fallback**: every unknown path returns `index.html` (React Router).
- **Cache headers**:
  - `index.html`, `sw.js`, `manifest.webmanifest`, `registerSW.js`: `Cache-Control: no-cache`. Otherwise the "New version available" prompt never appears (architecture §6).
  - `/assets/*` (hashed): `Cache-Control: public, max-age=31536000, immutable`.
- **MIME**: `.webmanifest` → `application/manifest+json`.

Example `Caddyfile` (Railway static service):

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

## 5. Backups and operations

- **Backups:** nightly `pg_dump` by a worker job (or Railway's backups where available), compressed and uploaded to a separate R2 bucket; keep 30 daily + 12 monthly. **Test a restore once a month** into a scratch database.
- **Health:** `GET /health` checks DB connectivity; the host restarts the service if it fails.
- **Logs:** pino JSON logs to stdout; the host keeps them. Never log tokens, PINs or OTP codes.
- **Scaling path:** more API copies → PgBouncer (transaction mode) in front of Postgres → bigger Postgres → read replica for reports. No code changes needed for any of these.
- **Moving hosts:** (1) create the new Postgres, (2) `pg_dump` / `pg_restore`, (3) copy storage objects by key, (4) point `DATABASE_URL` / `S3_*` at the new place, (5) redeploy the same Docker image, (6) change DNS. Keep the old host read-only until the new one is verified.

## 6. Cost plan (estimates)

Prices are rough and change; PKR at about Rs 280 = $1. Check host pricing pages before launch.

| Stage | Setup | Approx. monthly |
| --- | --- | --- |
| Build + pilot | Railway Hobby (usage-based, $5 minimum credited as usage): API + worker + Postgres + 2 static sites at low load; R2 free tier; SMTP free tier | roughly Rs 1,500–5,000 |
| Growing | Bigger Railway usage, or one VPS (API, worker, Postgres) + R2 | roughly Rs 3,000–10,000 |

No per-user fees and no plan jumps: cost follows real CPU, memory, storage and traffic. If Railway becomes expensive, the same Docker image and a `pg_dump` move to a VPS.

**Why not Supabase (decided Nov 2026):** good product, but auth, storage and the API would live in a vendor platform, Pro costs ~Rs 7,000/month regardless of usage, and local development needed ~10 Docker containers. Own backend keeps every part standard and movable. A Supabase project `naqdpos` was created during evaluation; delete it once nothing uses it.

## 7. Open items
- SMTP provider for OTP emails (architecture §8).
- Google OAuth client (consent screen, privacy policy URL, redirect URLs for `api.`, `pos.`, `admin.` domains).
- Phone OTP provider — deferred until business registration and Meta verification.
- Test Google sign-in inside the installed PWA on iOS (architecture §5).
- Choose the serving domain (naqd.pk suggested) for `pos.`, `admin.`, `api.` (§0).
- Register naqdpos.com (§0).
