// Local database tasks: create | up | new <name> | reset | test.
// Runs with plain Node (type stripping). Connection strings come from the root .env and are
// never printed, because they hold passwords.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const ROOT = resolve(import.meta.dirname, '../..');
const ENV_FILE = join(ROOT, '.env');
const MIGRATIONS_DIR = join(ROOT, 'db/migrations');
const DBMATE_CLI = join(ROOT, 'db/node_modules/dbmate/dist/cli.js');

const DEV_DB = 'naqdpos_dev';
const TEST_DB = 'naqdpos_test';
const APP_ROLE = 'naqdpos_app';

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function fail(message: string): never {
  console.error(`db: ${message}`);
  process.exit(1);
}

function adminUrl(database: string): string {
  const raw = process.env.DATABASE_ADMIN_URL;
  if (!raw) fail('DATABASE_ADMIN_URL is not set in .env');
  const url = new URL(raw);
  url.pathname = `/${database}`;
  return url.toString();
}

function appUrl(database: string, password: string): string {
  const url = new URL(adminUrl(database));
  url.username = APP_ROLE;
  url.password = password;
  return url.toString();
}

/** Sets keys in .env, keeping every other line as it is. */
function setEnv(values: Record<string, string>): void {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  }
  writeFileSync(ENV_FILE, lines.join('\n').replace(/\n*$/, '\n'));
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function canConnect(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    await withClient(url, (c) => c.query('select 1'));
    return true;
  } catch {
    return false;
  }
}

function run(
  label: string,
  command: string,
  args: string[],
  options: { shell?: boolean; env?: NodeJS.ProcessEnv } = {},
): void {
  const spawnOptions = { stdio: 'inherit' as const, cwd: ROOT, ...options };
  // With a shell, Node wants one command string (our arguments here are fixed, never user input).
  const result = options.shell
    ? spawnSync([command, ...args].join(' '), spawnOptions)
    : spawnSync(command, args, spawnOptions);
  // Only the task name: the arguments can hold connection strings with passwords.
  if (result.status !== 0) fail(`${label} failed`);
}

/** dbmate's driver defaults to SSL; a local server has none, so turn it off for localhost only. */
function dbmateUrl(database: string): string {
  const url = new URL(adminUrl(database));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (local && !url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

/** dbmate as the admin (owner) role; never dumps schema.sql (pg_dump is not required). */
function dbmate(database: string, ...args: string[]): void {
  run(`dbmate ${args.join(' ')} (${database})`, process.execPath, [
    DBMATE_CLI,
    '--url',
    dbmateUrl(database),
    '--migrations-dir',
    MIGRATIONS_DIR,
    '--no-dump-schema',
    ...args,
  ]);
}

async function create(): Promise<void> {
  await withClient(adminUrl('postgres'), async (client) => {
    for (const name of [DEV_DB, TEST_DB]) {
      const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
        name,
      ]);
      if (rowCount) console.log(`db: ${name} exists`);
      else {
        await client.query(`create database ${name}`);
        console.log(`db: created ${name}`);
      }
    }

    const current = process.env.DATABASE_URL;
    const keep =
      current !== undefined &&
      new URL(current).username === APP_ROLE &&
      (await canConnect(current)) &&
      (await canConnect(process.env.TEST_DATABASE_URL));
    let password: string;
    if (keep && current) {
      password = decodeURIComponent(new URL(current).password);
      console.log(`db: role ${APP_ROLE} already works, password kept`);
    } else {
      // base64url has no quote characters, so it is safe inside a SQL string literal.
      password = randomBytes(24).toString('base64url');
      const { rowCount } = await client.query('select 1 from pg_roles where rolname = $1', [
        APP_ROLE,
      ]);
      const verb = rowCount ? 'alter' : 'create';
      await client.query(
        `${verb} role ${APP_ROLE} with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '${password}'`,
      );
      console.log(`db: ${verb === 'create' ? 'created' : 'reset password of'} role ${APP_ROLE}`);
    }

    const values: Record<string, string> = {
      DATABASE_URL: appUrl(DEV_DB, password),
      TEST_DATABASE_URL: appUrl(TEST_DB, password),
    };
    // Local defaults for the API, only when missing.
    if (!process.env.BETTER_AUTH_SECRET)
      values.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
    if (!process.env.BETTER_AUTH_URL) values.BETTER_AUTH_URL = 'http://localhost:8787';
    if (!process.env.APP_ORIGINS)
      values.APP_ORIGINS = 'http://localhost:5173,http://localhost:5174';
    setEnv(values);
    console.log(`db: wrote ${Object.keys(values).join(', ')} to .env`);
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'create':
      return create();
    case 'up':
      return dbmate(DEV_DB, 'up');
    case 'new':
      if (!args[0]) fail('usage: pnpm db:new <name>');
      return run('dbmate new', process.execPath, [
        DBMATE_CLI,
        '--migrations-dir',
        MIGRATIONS_DIR,
        'new',
        args[0],
      ]);
    case 'reset':
      dbmate(DEV_DB, 'drop');
      dbmate(DEV_DB, 'create');
      return dbmate(DEV_DB, 'up');
    case 'test': {
      dbmate(TEST_DB, 'drop');
      dbmate(TEST_DB, 'create');
      dbmate(TEST_DB, 'up');
      // pnpm is a .cmd shim on Windows, so it needs a shell. Tests never run as development.
      const testEnv = { ...process.env, NODE_ENV: 'test' };
      run('db tests', 'pnpm', ['--filter', '@naqdpos/db', 'run', 'test:db'], {
        shell: true,
        env: testEnv,
      });
      return run('api db tests', 'pnpm', ['--filter', '@naqdpos/api', 'run', 'test:db'], {
        shell: true,
        env: testEnv,
      });
    }
    default:
      fail('usage: node db/scripts/db.ts create|up|new <name>|reset|test');
  }
}

await main();
