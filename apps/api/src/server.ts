// API entry point. The worker (pg-boss jobs, nightly backup) is src/worker.ts, same image.
import { serve } from '@hono/node-server';
import { sql } from 'kysely';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb } from './db/index.ts';
import { loadEnv, mailSettings, s3Settings } from './env.ts';
import { createLogger } from './logger.ts';
import { createMailer } from './mailer.ts';
import { s3Store } from './storage.ts';

// Startup check: lists every missing or invalid setting by name, then stops (env.ts).
const env = loadEnv();
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
const authPool = createAuthPool(env.DATABASE_URL);
const mail = mailSettings(env);
const mailer = mail ? createMailer(mail, logger) : null;
const s3 = s3Settings(env);
const auth = createAuth(env, { pool: authPool, logger, mailer });

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
