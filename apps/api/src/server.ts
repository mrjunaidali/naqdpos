// API entry point. The worker (pg-boss jobs) gets its own entry when the first job exists.
import { serve } from '@hono/node-server';
import { sql } from 'kysely';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb } from './db/index.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

const env = loadEnv();
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
const authPool = createAuthPool(env.DATABASE_URL);
const auth = createAuth(env, { pool: authPool, logger });

const app = createApp({
  db,
  auth,
  logger,
  origins: env.APP_ORIGINS,
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
  logger.info({ port: info.port, env: env.NODE_ENV }, 'NaqdPOS API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void Promise.all([db.destroy(), authPool.end()]).then(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
