// `pnpm db:deploy`: applies new migrations to the database in DATABASE_ADMIN_URL exactly as given
// (staging / production; Railway runs it as the API's pre-deploy command,
// `node /repo/db/scripts/migrate.ts`). Local databases use `pnpm db:up` instead. The URL is never
// printed: it holds the owner password.
//
// Any failure exits non-zero, so the host stops the deploy and the old API keeps running: dbmate
// failing, dbmate not starting, or a migration still pending afterwards. Each applied file is
// logged, then "db:deploy: migrations are up to date".
//
// Railway's private network has no TLS: add ?sslmode=disable to an internal
// (*.railway.internal) URL. Public URLs keep TLS (dbmate's default).
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const ENV_FILE = join(ROOT, '.env');
if (existsSync(ENV_FILE) && !process.env.DATABASE_ADMIN_URL) process.loadEnvFile(ENV_FILE);

function fail(message: string, code = 1): never {
  console.error(`db:deploy: ${message}`);
  process.exit(code);
}

const url = process.env.DATABASE_ADMIN_URL;
if (!url) fail('DATABASE_ADMIN_URL is not set');

const cli = join(ROOT, 'db/node_modules/dbmate/dist/cli.js');
const migrationsDir = join(ROOT, 'db/migrations');
if (!existsSync(cli)) fail(`dbmate is not installed (${cli})`);
if (!existsSync(migrationsDir)) fail(`no migrations folder (${migrationsDir})`);

// The URL goes in dbmate's own DATABASE_URL variable, not on the command line.
function dbmate(args: string[], capture: boolean): SpawnSyncReturns<string> {
  const result = spawnSync(
    process.execPath,
    [cli, '--migrations-dir', migrationsDir, '--no-dump-schema', '--wait', ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url },
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    },
  );
  if (result.error) fail(`could not run dbmate: ${result.error.message}`);
  if (result.signal) fail(`dbmate ${args[0]} was stopped by ${result.signal}`);
  return result;
}

/** `dbmate status` lines: "[X] 2026…_name.sql" applied, "[ ] 2026…_name.sql" pending. */
function pending(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => /^\[ \] (\S+\.sql)$/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined);
}

const before = dbmate(['status'], true);
if (before.status !== 0) fail('could not read the migration status', before.status ?? 1);
const toApply = pending(before.stdout);
console.log(`db:deploy: ${toApply.length} migration(s) to apply`);
for (const name of toApply) console.log(`db:deploy: pending ${name}`);

// dbmate prints "Applying: <file>" / "Applied: <file> in …" for each one; each runs in its own
// transaction, so a failure leaves the earlier ones applied and the failed one not.
const up = dbmate(['up'], false);
if (up.status !== 0) fail('migrations failed', up.status ?? 1);

const after = dbmate(['status'], true);
const left = after.status === 0 ? pending(after.stdout) : null;
if (left === null) fail('could not read the migration status after applying');
if (left.length > 0) fail(`still pending after dbmate up: ${left.join(', ')}`);

for (const name of toApply) console.log(`db:deploy: applied ${name}`);
console.log('db:deploy: migrations are up to date');
