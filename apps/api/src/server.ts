// API entry point. The worker (pg-boss jobs, nightly backup) is src/worker.ts, same image.
import { serve } from '@hono/node-server';
import { sql } from 'kysely';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb } from './db/index.ts';
import { MIGRATIONS_DIR, migrationVersions, pendingMigrations } from './db/migrations.ts';
import { loadEnv, mailSettings, s3Settings } from './env.ts';
import { createLogger } from './logger.ts';
import { createMailer } from './mailer.ts';
import { s3Store } from './storage.ts';

// Startup check: lists every missing or invalid setting by name, then stops (env.ts).
const env = loadEnv();
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL, logger);
const authPool = createAuthPool(env.DATABASE_URL, logger);
const mail = mailSettings(env);
const mailer = mail ? createMailer(mail, logger) : null;
const s3 = s3Settings(env);
const auth = createAuth(env, { pool: authPool, logger, mailer });

// A database behind this API (migrations not run) breaks sync on every device, so don't start:
// on a deploy the healthcheck then fails and the old API keeps serving. A database that can't be
// reached is different: start anyway, /health answers 503 until it is back. No migration files
// (a broken image) throws here and stops the API.
const expectedMigrations = migrationVersions();
if (expectedMigrations.length === 0) throw new Error(`no migration files in ${MIGRATIONS_DIR}`);
try {
  const pending = await pendingMigrations(db, expectedMigrations);
  if (pending.length > 0) {
    logger.fatal(
      { pending },
      'the database is behind this API: run the migrations (pnpm db:deploy, or pnpm db:up locally)',
    );
    process.exit(1);
  }
} catch (error) {
  logger.error({ err: error }, 'could not check the database migrations; starting anyway');
}

// Without the client-IP header every client shares one sign-in rate-limit bucket per path.
if (env.NODE_ENV === 'production' && !env.CLIENT_IP_HEADER)
  logger.warn('CLIENT_IP_HEADER is not set: sign-in rate limits are shared by all clients');
if (env.LOG_FULL_CLIENT_IP)
  logger.warn('LOG_FULL_CLIENT_IP is on: full client IPs are logged (turn it off after the test)');

// A wrong email login is logged loudly at start, but doesn't stop the API: selling never needs
// email, and the host would restart it in a loop.
if (mailer) void mailer.verify();

const app = createApp({
  db,
  auth,
  logger,
  origins: env.APP_ORIGINS,
  minAppVersion: env.MIN_APP_VERSION,
  files: s3 ? s3Store(s3) : null,
  mailer,
  posUrl: env.POS_URL,
  clientIpHeader: env.CLIENT_IP_HEADER,
  logFullClientIp: env.LOG_FULL_CLIENT_IP,
  checkDb: async () => {
    try {
      await sql`select 1`.execute(db);
      return true;
    } catch {
      return false;
    }
  },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(
    { port: info.port, env: env.NODE_ENV, email: Boolean(mailer), files: Boolean(s3) },
    'NaqdPOS API listening',
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void Promise.all([db.destroy(), authPool.end()]).then(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
