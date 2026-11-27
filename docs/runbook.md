# NaqdPOS runbook

Operations that are done by hand: first-time database steps, the first admin, backups and the monthly restore drill, and what to do when something breaks. Hosting setup is in `docs/deployment.md` §6; settings in §2.

Conventions: `<staging|production>` = the Railway environment. "Public URL" = the Postgres service's `DATABASE_PUBLIC_URL` (Railway → Postgres → Connect), the only way to reach the database from a PC. Never paste connection strings or keys into chat, tickets or commit messages.

## 1. First deploy: the app role

The first migration creates `naqdpos_app` **without login** (no password can live in a migration). Once per environment, after the first API deploy has run the migrations:

1. Make the password the Railway shared variable `APP_DB_PASSWORD` of that environment (deployment §6 step 4). Use only letters, digits, `-` and `_`.
2. Railway → Postgres → **Data → Query** (or `psql '<public URL>'`), run:
   ```sql
   alter role naqdpos_app login password '<APP_DB_PASSWORD>';
   ```
3. Redeploy `api`. `https://<api>/health` must answer `{"ok":true,"db":true}`.

To change the password later: set the new value in `APP_DB_PASSWORD`, run the `alter role` again with it, redeploy `api`.

## 2. First admin (and more admins)

1. The person signs in once on the admin portal (email code or Google), so their user exists.
2. On a PC with the repo:
   ```sh
   DATABASE_ADMIN_URL='<public URL>' pnpm admin:grant person@example.com
   ```
   (PowerShell: `$env:DATABASE_ADMIN_URL='<public URL>'; pnpm admin:grant person@example.com`.)
3. They sign in again and set up the authenticator app (TOTP); keep the backup codes.

Remove: `pnpm admin:revoke person@example.com` the same way. Both are audit-logged. There is no API route for this on purpose.

## 3. Backups (US008)

- **What runs:** the `worker` service, every night at **02:00 Asia/Karachi**: `pg_dump --format=custom` of the whole database (owner role, `DATABASE_ADMIN_URL`) → AES-256-GCM with `BACKUP_ENCRYPTION_KEY` → the backups bucket:
  - `backups/daily/YYYY-MM-DD.dump.enc` every night,
  - `backups/monthly/YYYY-MM.dump.enc` on the 1st of each month,
  - kept: the newest **30 daily** and **12 monthly**; older ones are deleted by the same job.
- **Check it ran:** worker log lines `backup uploaded` (with the keys) and, when something was pruned, `old backups deleted`. A failure logs `backup failed` and pg-boss retries twice, 10 minutes apart. If the worker was down at 02:00 (a deploy), the missed backup runs once when it starts.
- **List backups:** `pnpm backup:restore --list` (needs the `BACKUP_S3_*` settings of that environment in `.env` or the shell).
- **The encryption key** is in Railway (`worker` → `BACKUP_ENCRYPTION_KEY`) **and in the password manager**. Losing it makes every backup useless. Never change it without keeping the old one (§3.2).

### 3.1 A backup now

Railway → `worker` → **Restart** does not start a backup. Ask the running worker for one from a PC:

```sh
DATABASE_ADMIN_URL='<public URL>' pnpm backup:now
```

(PowerShell: `$env:DATABASE_ADMIN_URL='<public URL>'; pnpm backup:now`, then `Remove-Item Env:DATABASE_ADMIN_URL`.) It prints the host and database it used (check it is the right environment) and `queued job <id>`. All it does is queue one job in that database's pg-boss queue. The worker picks it up within seconds and does exactly what it does at 02:00, so its log shows `backup uploaded` with `backups/daily/<today>.dump.enc`, and the backups bucket has the file (a second run the same day overwrites it). `no queue "nightly-backup"` = the worker has never started on that database.

A local copy outside the backups bucket (before a risky change) instead:

```sh
pg_dump --format=custom --no-password -d '<public URL>' -f before-change.dump
```

(pg_dump 18 or newer.) Keep the file encrypted (e.g. in the password manager's file storage) and delete it when no longer needed: it holds every shop's data.

### 3.2 Changing the encryption key

1. Generate a new key: `openssl rand -base64 32`. Store it in the password manager **next to the old one**, with the date.
2. Set it as `BACKUP_ENCRYPTION_KEY` on `worker`; redeploy.
3. Backups from before the change still need the old key for 30 days (daily) / 12 months (monthly). Delete the old key from the password manager only after the last backup made with it has expired.

## 4. Monthly restore drill

Once a month (first working day), and once on staging before the pilot. Takes about 15 minutes. It proves that last night's backup can be downloaded, decrypted and restored, and that the data is there.

1. **Settings on the PC:** in `.env` (or the shell) set that environment's `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` and `BACKUP_ENCRYPTION_KEY` (from the password manager). `pg_restore` 18 or newer on `PATH`, or `PG_BIN_DIR` set (Windows: `C:\Program Files\PostgreSQL\18\bin`).
2. **A scratch database** on the PC's own Postgres, plus the app role it grants to:
   ```sh
   psql -U postgres -c "create database naqdpos_restore_drill"
   ```
   (`naqdpos_app` already exists on a dev PC from `pnpm db:create`. On a fresh server: `create role naqdpos_app nologin;` first.)
3. **Pick the backup:** `pnpm backup:restore --list` → the newest `backups/daily/…` key.
4. **Restore:**
   ```sh
   pnpm backup:restore backups/daily/2026-12-01.dump.enc postgres://postgres:<pw>@localhost:5432/naqdpos_restore_drill
   ```
   It refuses a database that already has tables. The file is fully decrypted and checked (a wrong key or a changed file stops here) before `pg_restore` runs, in one transaction. It prints row counts of `shops`, `staff`, `products`, `sales`, `khata_entries`, `expenses`.
5. **Compare** with the environment the backup came from (Railway → that environment → Postgres → Query; read-only `select`s, nothing else there):
   ```sql
   select (select count(*) from shops) shops, (select count(*) from staff) staff,
          (select count(*) from products) products, (select count(*) from sales) sales,
          (select count(*) from khata_entries) khata, (select count(*) from expenses) expenses;
   ```
   Every number must match the restore's, except rows added after the backup ran (a 02:00 backup misses today's sales: compare `sales` with `… where business_date < current_date`). For a backup made minutes ago with `pnpm backup:now` (staging) they match exactly unless someone used staging in between.
6. **Spot check:** `select max(business_date) from sales;` in the scratch database is yesterday's date (or the last day anyone sold).
7. **Clean up:** `psql -U postgres -c "drop database naqdpos_restore_drill"` and remove the backup settings from `.env`.
8. **Record it** in the drill log below: date, environment, backup key, counts match yes/no, time taken, problems.

| Date | Env | Backup key | Counts match | Minutes | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

If anything fails, treat it as an incident (§5): backups that can't be restored are not backups.

## 5. Disaster restore (the production database is lost or damaged)

1. **Stop writes**: Railway → `api` and `worker` → scale to 0 / remove the deployment. Shop devices keep selling offline; their outboxes keep every change (architecture §4) and push them once the API is back.
2. **New database**: in the same environment add a new PostgreSQL **18** service (or fix the old one). Create the app role on it: `create role naqdpos_app nologin;`.
3. **Restore** the newest good backup into it (it must be empty):
   ```sh
   pnpm backup:restore backups/daily/<date>.dump.enc '<new database public URL>'
   ```
4. **App role password**: `alter role naqdpos_app login password '<APP_DB_PASSWORD>';` (§1).
5. **Point the services** at the new database: update `DATABASE_URL` / `DATABASE_ADMIN_URL` references to the new Postgres service, redeploy `api` (its pre-deploy applies any migration newer than the backup), then `worker`.
6. **Check**: `/health`, sign in, a shop's sales list. Devices push what they sold since the backup; `sync_push` is idempotent, so nothing doubles.
7. **Afterwards**: write down what happened and the time without service.

## 6. Incidents and quick checks

| Symptom | Check | Fix |
| --- | --- | --- |
| API won't start, log says `Invalid api settings:` | The message lists every missing / wrong variable by name | Set them on the `api` service, redeploy |
| `/health` → `db: false` | Postgres service up? `naqdpos_app` password (§1)? `?sslmode=disable` on internal URLs | Fix the variable or the role password, redeploy |
| Nobody receives sign-in codes, or the screen says "Couldn't send the code, try again" | API log: `email code not sent` (its `err`: `Resend API: HTTP 401/403 (…)` = bad key or unverified domain; `no answer within 10 s` = provider unreachable) / `email sent` lines; with SMTP also `email check failed` at start; Resend dashboard → Logs | On Railway use `RESEND_API_KEY`, not `SMTP_*` (Hobby blocks SMTP ports: SMTP sends time out). Fix the key; check the domain is still verified; check the Resend daily limit |
| Invite shows "The email was not sent" | Same as above | The WhatsApp text in the portal always works |
| Logo upload fails | Browser console: CORS error → R2 CORS policy (deployment §6 step 2); CSP error → `FILES_ORIGIN` on the `pos` service | Fix and retry; the old logo stays until a new one is saved |
| Worker: `backup failed` | The log line has the step (`pg_dump failed …`, storage error) | `pg_dump` version vs Postgres version (must be ≥ 18); backup token scope; bucket name |
| A deploy is stuck in pre-deploy | Railway deploy logs: `db:deploy: migrations failed` with dbmate's message | Fix the migration in a new migration (never edit an old one); the old version keeps running meanwhile |
| Apps show "Update required to sync" | `MIN_APP_VERSION` on `api` | Unset it unless a breaking sync change was released (architecture §4) |
