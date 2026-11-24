# NaqdPOS hosting and deployment

Status: **decided (Nov 2026)**. Own backend on open standards: Node API + PostgreSQL + S3-compatible storage + SMTP. Railway (API, worker, Postgres, two static sites) + Cloudflare R2 + Resend (SMTP); every part can move to another host by changing environment variables. Supabase was evaluated and dropped (§7).

Day-to-day operations (backups, restore drill, first-time database steps, incidents) are in **`docs/runbook.md`**.

## 0. Brand and domains

- Brand: **Naqd** (local) / **NaqdPOS** (app stores).
- Registered (Nov 2026): **naqd.pk**, **naqdpos.pk**, **naqd.com.pk**. DNS for naqd.pk is on Cloudflare.
- **Serving domain: naqd.pk** (decided 24 Nov 2026):

| | Production | Staging |
| --- | --- | --- |
| Shop app (`apps/pos`) | `https://pos.naqd.pk` | `https://staging-pos.naqd.pk` |
| Admin portal (`apps/admin`) | `https://admin.naqd.pk` | `https://staging-admin.naqd.pk` |
| API (`apps/api`) | `https://api.naqd.pk` | `https://staging-api.naqd.pk` |
| Email sender | `no-reply@naqd.pk` | same domain (separate API key) |

- Not yet registered: naqdpos.com (free when checked 19 Nov 2026), naqd.com (for sale on Sedo), naqdly.com (possible future global brand).

## 1. What runs where

| Part | What it is | Runs on | Can move to |
| --- | --- | --- | --- |
| `apps/pos` | Static PWA (Vite build) served by Caddy (`deploy/static.Dockerfile`, `APP=pos`) | Railway service `pos` | Cloudflare Pages, Netlify, any web server |
| `apps/admin` | Static SPA, same image with `APP=admin` | Railway service `admin` | Same as above |
| `apps/api` (API) | Docker image `apps/api/Dockerfile`, Node 24 + Hono | Railway service `api` | Render, Fly, any VPS, AWS/Azure container services |
| `apps/api` (worker) | Same image, `node src/worker.ts` (pg-boss: nightly backup) | Railway service `worker` | Same as API |
| Database | PostgreSQL **18** | Railway Postgres (one per environment) | Neon, AWS RDS, DigitalOcean, own server |
| Files | S3 API: bucket per environment (shop logos; bill photos later) | Cloudflare R2 | AWS S3, Backblaze B2, MinIO |
| Backups | S3 API: a **separate** bucket per environment, own token | Cloudflare R2 | Any S3 storage |
| Email | SMTP (sign-in codes, PIN reset codes, owner invites) | Resend (SMTP relay) | Any SMTP provider |
| Phone OTP (later) | WhatsApp auth template, SMS fallback | Deferred until business registration and Meta verification | — |

Region: as close to Pakistan as the host offers (Railway: Singapore / Asia; R2 location hint: Asia-Pacific). The shop app is offline-first, so latency matters less than usual.

## 2. Settings (environment variables)

Moving a part = changing its settings. Nothing host-specific is in code. Secrets live only in Railway's variables and the password manager; never in the repo or a front-end build. `.env.example` lists every variable.

**The API and the worker check their settings at start** and stop with one message that names every missing or invalid setting (never its value). In production the API requires `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥ 32 chars), `BETTER_AUTH_URL` (https), `APP_ORIGINS` (all https), `POS_URL` (https) and all of `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. `S3_*` is all-or-nothing (none = the logo feature is hidden). The worker requires `DATABASE_ADMIN_URL`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` and `BACKUP_ENCRYPTION_KEY` (32 bytes, base64).

| Service | Variable | Production | Staging | Note |
| --- | --- | --- | --- | --- |
| api | `DATABASE_URL` | `postgres://naqdpos_app:${{shared.APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}?sslmode=disable` | same form | App role (RLS applies). Private network: no TLS, so `sslmode=disable` |
| api, worker | `DATABASE_ADMIN_URL` | `${{Postgres.DATABASE_URL}}?sslmode=disable` | same | Owner role: migrations (pre-deploy), pg-boss schema, backups |
| api | `BETTER_AUTH_SECRET` | 64 random hex chars (`openssl rand -hex 32`) | a **different** one | |
| api | `BETTER_AUTH_URL` | `https://api.naqd.pk` | `https://staging-api.naqd.pk` | |
| api | `APP_ORIGINS` | `https://pos.naqd.pk,https://admin.naqd.pk` | `https://staging-pos.naqd.pk,https://staging-admin.naqd.pk` | CORS and Better Auth trusted origins |
| api | `POS_URL` | `https://pos.naqd.pk` | `https://staging-pos.naqd.pk` | In the owner invite email |
| api | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | production OAuth client | staging OAuth client | Empty = Google sign-in hidden |
| api | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | `smtp.resend.com`, `587`, `resend`, production API key | same, staging API key | |
| api | `MAIL_FROM` | `NaqdPOS <no-reply@naqd.pk>` | `NaqdPOS staging <no-reply@naqd.pk>` | |
| api | `S3_ENDPOINT`, `S3_REGION` | `https://<account-id>.r2.cloudflarestorage.com`, `auto` | same | |
| api | `S3_BUCKET` | `naqdpos-files-prod` | `naqdpos-files-staging` | |
| api | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | files-prod token | files-staging token | Token scoped to **that bucket only** |
| api | `MIN_APP_VERSION` | (unset) | (unset) | Raise only for a breaking sync change (architecture §4) |
| api, worker | `LOG_LEVEL` | `info` | `info` | `NODE_ENV` is already `production` in the image |
| worker | `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION` | `https://<account-id>.r2.cloudflarestorage.com`, `auto` | same | |
| worker | `BACKUP_S3_BUCKET` | `naqdpos-backups-prod` | `naqdpos-backups-staging` | |
| worker | `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | backups-prod token | backups-staging token | Token scoped to **that bucket only** |
| worker | `BACKUP_ENCRYPTION_KEY` | `openssl rand -base64 32` | a **different** one | Copy into the password manager. Without it no backup can be restored |
| pos | `APP` | `pos` | `pos` | Build arg: which app the static image builds |
| pos, admin | `VITE_API_URL` | `https://api.naqd.pk` | `https://staging-api.naqd.pk` | Build arg (baked into the JavaScript) |
| admin | `APP` | `admin` | `admin` | |
| admin | `VITE_POS_URL` | `https://pos.naqd.pk` | `https://staging-pos.naqd.pk` | Build arg: app address in the invite WhatsApp text |
| pos, admin | `API_ORIGIN` | `https://api.naqd.pk` | `https://staging-api.naqd.pk` | Run time: Caddy's CSP `connect-src` |
| pos, admin | `FILES_ORIGIN` | `https://<account-id>.r2.cloudflarestorage.com` | same | Run time: CSP `img-src` / `connect-src` for logo upload and download |

`shared.APP_DB_PASSWORD` is a Railway **shared variable** per environment holding the `naqdpos_app` password (runbook "First deploy"). `${{Postgres.…}}` are Railway reference variables to the environment's Postgres service.

**Rate limiting is in memory** (Better Auth's limiter, plus 30 `/files` requests per user per minute). That is correct with **one API instance** (`numReplicas: 1` in `apps/api/railway.json`). Before running more API copies, switch Better Auth's `rateLimit.storage` to `'database'` (a table in a migration) and move the `/files` counter to Postgres too; otherwise each copy counts separately. Behind Railway the client IP comes from `X-Forwarded-For`; if the API logs "Rate limiting could not determine a client IP", set Better Auth's `advanced.ipAddress.ipAddressHeaders`.

## 3. Environments, CI and deploys

| Env | Database | API / worker | Front ends | Deploys from |
| --- | --- | --- | --- | --- |
| Local | Postgres on the PC (`naqdpos_dev`, `naqdpos_test`; 17 or 18, see below) | `pnpm --filter @naqdpos/api dev`; worker `pnpm --filter @naqdpos/api worker:dev` | `pnpm --filter @naqdpos/pos dev` (5173), `pnpm --filter @naqdpos/admin dev` (5174) | — |
| Staging | Railway Postgres 18 (staging environment) | Railway `api`, `worker` | `staging-pos.`, `staging-admin.` | branch `main`, after CI passes |
| Production | Railway Postgres 18 (production environment) | Railway `api`, `worker` | `pos.`, `admin.` | branch `release`, moved to each `v*` tag |

- **Postgres version:** staging and production run **PostgreSQL 18** (Railway's template default), and CI runs 18, so **CI is the reference**. A dev PC may stay on Postgres 17 for now: our SQL uses nothing that differs between 17 and 18. For a restore from staging or production on a PC you need `pg_restore` 18 (runbook §4).
- **CI** (`.github/workflows/ci.yml`, every push and pull request):
  - `checks`: install, lint, format check, typecheck, unit tests, `check:precache`.
  - `db`: a Postgres 18 service and the PGDG `postgresql-client-18` on the runner, then `pnpm db:create` + `pnpm db:test` (RLS and SQL tests, API database tests, the backup → restore test with real `pg_dump` / `pg_restore`).
  - `e2e`: Playwright smoke test (§4) against the real builds behind Caddy with `deploy/Caddyfile`; browsers cached with `actions/cache`.
  - `docker`: builds the API image (checks `pg_dump` 18 and the migration tool are inside) and both static images, starts the POS image and checks its headers.
- **Staging deploys `main`**: in Railway, each staging service's source is the GitHub repo, branch `main`, with **"Wait for CI"** on, so a red CI never deploys.
- **Production deploys release tags**: Railway can't follow tags, so the production services track the branch **`release`**, and `.github/workflows/release.yml` moves `release` to the commit of every pushed `v*` tag (only tags on `main`). To release: `git tag v1.2.0 && git push origin v1.2.0`. Nobody pushes to `release` by hand. Optionally protect `release` in GitHub so only the Actions bot may push.
- **Migrations**: the API service's **pre-deploy command** (`node /repo/db/scripts/migrate.ts`, i.e. `pnpm db:deploy`) runs `dbmate up` with `DATABASE_ADMIN_URL` before each new API version starts; a failed migration stops the deploy and the old version keeps running. Staging gets every migration before production. The database must always be rebuildable from `db/migrations`.
- **Offline first launch (check before each release):** `pnpm check:precache` (also in CI) fails if the service worker doesn't precache the app shell, the Urdu font (both weights), the icons and the manifest. Then by hand: open the app once online, install it, sign in and register the device; turn the network off, close the app completely, open it from the home screen, and complete a cash sale. It must open, sell and show "Saved offline".
- **System admins:** `pnpm admin:grant <email>` / `pnpm admin:revoke <email>` with `DATABASE_ADMIN_URL` set (a Railway database's own name is used as is; on a dev PC the default is `naqdpos_dev`, or set `NAQDPOS_ADMIN_DB`). The person must have signed in once. There is no API route for this.
- **Testing on a phone (Local, development only):** `pnpm dev:lan` starts the API, the POS dev server and the admin dev server together and prints both phone addresses: POS `https://<PC's Wi-Fi IP>:5173`, admin portal `https://<PC's Wi-Fi IP>:5174`. Ports are fixed (`strictPort`).
  - Both dev servers listen on all interfaces with a self-signed HTTPS certificate (`@vitejs/plugin-basic-ssl`). Phones need a secure context for WebCrypto (PIN hashing), the service worker and `storage.persist()`.
  - The app calls the API through the dev server's `/api` proxy (`/api/*` → `http://localhost:8787`). `dev:lan` sets `VITE_API_URL=/api`; on the dev server an empty or `/api` value means `<page origin>/api` (`apiBaseUrl` in `packages/core/src/api/baseUrl.ts`). No CORS, no mixed content.
  - The admin portal's invite text uses `VITE_POS_URL`; `dev:lan` sets it to `https://<first Wi-Fi IP>:5173`.
  - Steps: the phone joins the same Wi-Fi; open the printed address; accept the certificate warning once per port; sign in with an email code (printed by the API in development when SMTP isn't set). If the phone cannot connect, allow both ports on Private networks once, from an admin PowerShell: `New-NetFirewallRule -DisplayName "NaqdPOS dev servers (5173, 5174)" -Direction Inbound -Protocol TCP -LocalPort 5173,5174 -Action Allow -Profile Private`.
- **Database roles:** created by the first migration: the owner role runs migrations; `naqdpos_app` (API; no `BYPASSRLS`, owns nothing) is created `nologin` and given a password once by hand (runbook).

## 4. Static hosting (front ends)

Both apps use **`deploy/static.Dockerfile`** (build arg `APP=pos|admin`): a Node stage builds the app with `VITE_API_URL` / `VITE_POS_URL`, then `caddy:2.11.9-alpine` serves it with **`deploy/Caddyfile`**:

- **HTTPS** ends at Railway's edge; Caddy serves HTTP inside. Service workers need the HTTPS domain.
- **SPA fallback**: unknown paths get `/index.html` (React Router). A missing `/assets/*` file is a **404** (never `index.html` served as JavaScript) and is not cached.
- **Cache headers**: `index.html` (also for `/` and deep links), `sw.js`, `registerSW.js`, `manifest.webmanifest`: `no-cache`, or the "New version available" prompt never appears (architecture §6). Existing `/assets/*` (hashed): `public, max-age=31536000, immutable`.
- **MIME**: `.webmanifest` → `application/manifest+json`.
- **Security headers** on every response: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and
  `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: <FILES_ORIGIN>; font-src 'self'; connect-src 'self' <API_ORIGIN> <FILES_ORIGIN>; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`.
  `API_ORIGIN` / `FILES_ORIGIN` are the static service's run-time variables, so changing them needs a restart, not a rebuild.
- **Keeping the CSP working**: no inline scripts or `<style>` blocks in the apps (React `style={{…}}` is set from JavaScript and is allowed). Zod 4 builds parsers with `new Function`, which `script-src 'self'` blocks, so both apps import `@naqdpos/core/zod-config` **first** (`z.config({ jitless: true })`).
  - **Playwright smoke test** (`pnpm e2e`, in CI): builds both apps, serves them with this Caddyfile and fails on any CSP violation, console error or page error, and checks the headers, deep links, the 404 for missing assets and that the service worker registers. Locally it needs Caddy on `PATH` or `CADDY_BIN`, and `pnpm --filter @naqdpos/e2e exec playwright install chromium` once. The e2e package (`e2e/`) is ready for an offline-sale test later (same sites, a real API in place of the stub).

## 5. Backups and operations

- **Backups (US008):** the worker runs `pg_dump --format=custom` with `DATABASE_ADMIN_URL` **every night at 02:00 Asia/Karachi** (pg-boss cron; a night missed during a deploy runs once when the worker is back; 2 retries, 10 minutes apart). The dump is encrypted with **AES-256-GCM** (`BACKUP_ENCRYPTION_KEY`, streamed, file `NQBK1 | IV | ciphertext | tag`) and uploaded to the **backups bucket** as `backups/daily/YYYY-MM-DD.dump.enc`; on the 1st of the month also `backups/monthly/YYYY-MM.dump.enc`. The newest **30 daily and 12 monthly** are kept; older ones are deleted. **Restore drill once a month** (runbook).
- **Health:** `GET /health` checks DB connectivity; Railway's healthcheck uses it on deploy and restarts on failure. The static sites are checked on `/`.
- **Logs:** pino JSON logs to stdout; Railway keeps them. Never logged: tokens, PINs, PIN hashes, codes, passwords, connection strings (logger redaction, tested). Email logs show recipient and subject only.
- **Scaling path:** more API copies (first: shared rate-limit storage, §2) → PgBouncer (transaction mode) in front of Postgres → bigger Postgres → read replica for reports. `set_config(..., true)` is transaction-scoped, so it is safe with transaction pooling.
- **Moving hosts:** (1) create the new Postgres 18, (2) restore the latest backup into it (`pnpm backup:restore`, runbook), (3) copy storage objects by key (`rclone copy` between S3 endpoints), (4) point `DATABASE_URL` / `DATABASE_ADMIN_URL` / `S3_*` / `BACKUP_S3_*` at the new places, (5) deploy the same images, (6) change DNS. Keep the old host read-only until the new one is verified.

## 6. Setup, step by step

Do everything for **staging first**, check it (step 9), then repeat for production. Keep every secret in the password manager as you create it.

### 1. Cloudflare DNS (naqd.pk)

Records are added in steps 3 (Resend) and 6 (Railway domains). Use **DNS only (grey cloud)** for the six app records: Railway issues the certificates itself. (Proxied also works with SSL/TLS mode **Full (strict)**, but start with DNS only.)

### 2. Cloudflare R2: four buckets, four tokens

1. Cloudflare dashboard → R2 → **Create bucket**: `naqdpos-files-staging`, `naqdpos-files-prod`, `naqdpos-backups-staging`, `naqdpos-backups-prod`. Location hint **Asia-Pacific**. Public access: **off** for all four (everything goes through pre-signed URLs).
2. Note the **Account ID** (R2 overview). The S3 endpoint is `https://<account-id>.r2.cloudflarestorage.com`, region `auto`. That endpoint is also `FILES_ORIGIN`.
3. R2 → **Manage API tokens** → **Create API token**, four times, each with permission **Object Read & Write** and **"Apply to specific buckets only"** set to exactly one bucket:
   - `naqdpos-files-staging` token → staging `api` `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
   - `naqdpos-files-prod` token → production `api`
   - `naqdpos-backups-staging` token → staging `worker` `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`
   - `naqdpos-backups-prod` token → production `worker`
   A files token must never be able to read or delete backups, and the other way round.
4. **CORS on the two files buckets** (bucket → Settings → CORS policy). Staging:
   ```json
   [{ "AllowedOrigins": ["https://staging-pos.naqd.pk"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
   Production: the same with `https://pos.naqd.pk`. The backups buckets get **no** CORS policy.

### 3. Resend (email over SMTP)

1. resend.com → **Domains → Add domain** `naqd.pk`, region closest to Pakistan offered.
2. Add the records Resend shows in Cloudflare DNS (DNS only), typically: **MX** `send` → `feedback-smtp.<region>.amazonses.com` (priority 10); **TXT** `send` → `v=spf1 include:amazonses.com ~all`; **TXT** `resend._domainkey` → the DKIM key. Also add **TXT** `_dmarc` → `v=DMARC1; p=none;`. Click **Verify** and wait for "Verified".
3. **API keys** → create `naqdpos-staging` and `naqdpos-production`, permission **Sending access**, domain `naqd.pk`. Each key is the `SMTP_PASS` of that environment.
4. SMTP settings: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587` (STARTTLS; 465 also works), `SMTP_USER=resend`. Check the free-tier daily and monthly limits on Resend's pricing page before the pilot.

### 4. Railway project, environments and services

1. railway.com → **New project** `naqdpos` → connect the GitHub repo. In project settings create two **environments**: `staging` and `production`.
2. In **each** environment add a **PostgreSQL** database (name the service `Postgres`). It must be **version 18** (Railway's PostgreSQL template default; staging runs 18.7): check the template's image tag before creating it, and afterwards in the database's Query tab: `select version();` must say `PostgreSQL 18.x`. (`pg_dump` in the image is 18; it can dump 18 or older, not newer.)
3. In each environment create four services from the GitHub repo. For every service: **Root directory empty** (the Dockerfiles need the whole repo), **Config file path** as below, **branch** `main` in staging and `release` in production, and **"Wait for CI" on**.

   | Service | Config file path | Public networking |
   | --- | --- | --- |
   | `api` | `apps/api/railway.json` | yes (custom domain) |
   | `worker` | `apps/api/railway.worker.json` | none |
   | `pos` | `apps/pos/railway.json` | yes (custom domain) |
   | `admin` | `apps/admin/railway.json` | yes (custom domain) |

   The config files set the Dockerfile, the start command, `/health` checks, watch paths, one replica, and the API's pre-deploy migration.
4. Create the **shared variable** `APP_DB_PASSWORD` in each environment (`openssl rand -base64 24 | tr '+/' '-_'`, no quotes), then set every variable from the §2 table on each service.
5. Railway gives each Dockerfile service its variables as build arguments, so `APP`, `VITE_API_URL` and `VITE_POS_URL` reach the static builds. Changing a `VITE_*` value needs a **redeploy** (it is baked in at build time).

### 5. First deploy (order matters)

1. Deploy `api`. The pre-deploy command runs every migration (this creates the role `naqdpos_app` **without login**). The first API start then fails its healthcheck: expected.
2. Give `naqdpos_app` its password: runbook **"First deploy: the app role"**. Redeploy `api`; `/health` must return `{"ok":true,"db":true}`.
3. Deploy `worker`, `pos`, `admin`. The worker log shows `NaqdPOS worker started` with the 02:00 Asia/Karachi schedule.

### 6. Custom domains

For each public service: Railway → service → Settings → Networking → **Custom domain**, enter the name (staging: `staging-api.naqd.pk`, `staging-pos.naqd.pk`, `staging-admin.naqd.pk`; production: `api.naqd.pk`, `pos.naqd.pk`, `admin.naqd.pk`). Railway shows a **CNAME** target (and sometimes a TXT verification record); add them in Cloudflare DNS (DNS only). Wait until Railway shows the certificate as issued.

### 7. Google sign-in (OAuth)

1. Google Cloud Console → a project `NaqdPOS` → **APIs & Services → OAuth consent screen**: External; app name NaqdPOS; support email; authorized domain `naqd.pk`; privacy policy and terms URLs (needed before Google verifies the app for production use); scopes `openid`, `email`, `profile`.
2. **Credentials → Create OAuth client ID → Web application**, one client per environment:

   | | Authorized JavaScript origins | Authorized redirect URI |
   | --- | --- | --- |
   | Staging client | `https://staging-pos.naqd.pk`, `https://staging-admin.naqd.pk`, `https://staging-api.naqd.pk` | `https://staging-api.naqd.pk/auth/callback/google` |
   | Production client | `https://pos.naqd.pk`, `https://admin.naqd.pk`, `https://api.naqd.pk` | `https://api.naqd.pk/auth/callback/google` |

3. Put each client's ID and secret into that environment's `api` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and redeploy. Until then Google sign-in is simply hidden and email codes work.

### 8. First admin

1. Open the admin portal (`https://staging-admin.naqd.pk`) and sign in once with your email (code by email) or Google.
2. On your PC, with the environment's Postgres **public** URL (Railway → Postgres → Connect → `DATABASE_PUBLIC_URL`): `DATABASE_ADMIN_URL='<public url>' pnpm admin:grant you@example.com` (runbook "First admin"). Sign in again: the portal asks you to set up the authenticator app (TOTP).

### 9. Checks after each deploy

- `https://<api>/health` → `{"ok":true,"db":true}`; the API log line `NaqdPOS API listening` shows `email: true, files: true`, and no "SMTP check failed".
- Sign in on the POS with an email code (the email arrives in English and Urdu); create or open a shop; set a logo in Settings → Shop; it shows in the header and on a receipt.
- Browser dev tools on POS and admin: no CSP errors in the console; response headers as in §4.
- Admin portal: create a test shop → "Email sent to …"; the invite email arrives.
- The next morning: the worker log shows `backup uploaded` and the backups bucket has `backups/daily/<date>.dump.enc`. Do the restore drill once on staging (runbook) before the pilot.
- `MIN_APP_VERSION` is unset.

## 7. Cost plan (estimates)

Prices are rough and change; PKR at about Rs 280 = $1. Check host pricing pages before launch.

| Stage | Setup | Approx. monthly |
| --- | --- | --- |
| Build + pilot | Railway Hobby (usage-based, $5 minimum credited as usage): two environments × (API + worker + Postgres + 2 static sites) at low load; R2 free tier; Resend free tier | roughly Rs 2,000–6,000 |
| Growing | Bigger Railway usage, or one VPS (API, worker, Postgres) + R2 | roughly Rs 3,000–10,000 |

No per-user fees and no plan jumps: cost follows real CPU, memory, storage and traffic. If Railway becomes expensive, the same Docker images and a backup move to a VPS (§5).

**Why not Supabase (decided Nov 2026):** good product, but auth, storage and the API would live in a vendor platform, Pro costs ~Rs 7,000/month regardless of usage, and local development needed ~10 Docker containers. Own backend keeps every part standard and movable. A Supabase project `naqdpos` was created during evaluation; delete it once nothing uses it.

## 8. Open items

- Google OAuth consent screen verification (privacy policy and terms pages on naqd.pk).
- Phone OTP provider: deferred until business registration and Meta verification.
- Test Google sign-in inside the installed PWA on iOS (architecture §5).
- Register naqdpos.com (§0).
- Shared rate-limit storage before a second API instance (§2).
