// `pnpm db:deploy`: applies new migrations to the database in DATABASE_ADMIN_URL exactly as given
// (staging / production; Railway runs it as the API's pre-deploy command). Local databases use
// `pnpm db:up` instead. The URL is never printed: it holds the owner password.
//
// Railway's private network has no TLS: add ?sslmode=disable to an internal
// (*.railway.internal) URL. Public URLs keep TLS (dbmate's default).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const ENV_FILE = join(ROOT, '.env');
if (existsSync(ENV_FILE) && !process.env.DATABASE_ADMIN_URL) process.loadEnvFile(ENV_FILE);

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('db:deploy: DATABASE_ADMIN_URL is not set');
  process.exit(1);
}

const cli = join(ROOT, 'db/node_modules/dbmate/dist/cli.js');
// The URL goes in dbmate's own DATABASE_URL variable, not on the command line.
const result = spawnSync(
  process.execPath,
  [cli, '--migrations-dir', join(ROOT, 'db/migrations'), '--no-dump-schema', '--wait', 'up'],
  { stdio: 'inherit', cwd: ROOT, env: { ...process.env, DATABASE_URL: url } },
);
if (result.status !== 0) {
  console.error('db:deploy: migrations failed');
  process.exit(result.status ?? 1);
}
console.log('db:deploy: migrations are up to date');
