// Prints the SQL Better Auth would still need on the database in DATABASE_URL, or in the
// connection string named by the env var given as the first argument (e.g. TEST_DATABASE_URL).
// Use it after upgrading Better Auth or adding a plugin, and copy what it prints into a new
// dbmate migration. It only reads the catalog and never applies anything.
import { getMigrations } from 'better-auth/db/migration';
import { authOptions, createAuthPool } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';
import { createLogger } from '../src/logger.ts';

const env = loadEnv();
const url = process.argv[2] ? process.env[process.argv[2]] : env.DATABASE_URL;
if (!url) throw new Error(`${process.argv[2]} is not set`);
const pool = createAuthPool(url);
const options = authOptions(env, { pool, logger: createLogger({ ...env, NODE_ENV: 'test' }) });
const { compileMigrations } = await getMigrations(options);
const sql = (await compileMigrations()).trim();
console.log(sql && sql !== ';' ? sql : '-- nothing to do');
await pool.end();
