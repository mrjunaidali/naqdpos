// The sign-in code route when email can't be sent, against naqdpos_test (run by `pnpm db:test`).
// On a host that blocks SMTP the send used to hang the request; now it answers within the send
// timeout with EMAIL_SEND_FAILED, which the sign-in screens show as "Couldn't send the code".
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMAIL_SEND_FAILED } from '@naqdpos/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb } from './db/index.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';
import { createMailer, type Transport } from './mailer.ts';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
});
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
const authPool = createAuthPool(env.DATABASE_URL);

/** Like a blocked SMTP port: the connection never answers. */
const hanging: Transport = { sendMail: () => new Promise(() => {}) };
const TIMEOUT_MS = 300;
const mailer = createMailer(
  { kind: 'smtp', host: 'smtp.blocked.test', port: 587, user: 'u', pass: 'p', from: 'x@naqd.pk' },
  logger,
  { transport: hanging, timeoutMs: TIMEOUT_MS },
);
const auth = createAuth(env, { pool: authPool, logger, mailer });
const app = createApp({
  db,
  auth,
  logger,
  origins: env.APP_ORIGINS,
  mailer,
  checkDb: () => Promise.resolve(true),
});

afterAll(async () => {
  await Promise.all([db.destroy(), authPool.end()]);
});

describe('POST /auth/email-otp/send-verification-otp when email fails', () => {
  it('answers 503 EMAIL_SEND_FAILED within the send timeout instead of hanging', async () => {
    const started = Date.now();
    const res = await app.request('/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `u-${randomUUID()}@example.test`, type: 'sign-in' }),
    });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: EMAIL_SEND_FAILED,
      message: "Couldn't send the code, try again",
    });
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(TIMEOUT_MS + 3000);
  });
});
