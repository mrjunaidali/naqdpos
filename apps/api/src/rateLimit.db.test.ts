// Better Auth's rate limit per client IP (run by `pnpm db:test`). Staging, 27 Nov 2026: it
// logged "could not determine a client IP", so every client shared one sign-in bucket per path.
// With CLIENT_IP_HEADER (Railway: x-real-ip) each client IP has its own bucket.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuth, createAuthPool } from './auth.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

describe('Better Auth rate limit per client IP (CLIENT_IP_HEADER)', () => {
  // /auth/ok does no database work of its own; Better Auth checks its schema once on the first
  // request, hence the test database.
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:8787',
    APP_ORIGINS: 'http://localhost:5173',
    CLIENT_IP_HEADER: 'X-Real-IP',
  });
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' });

  const pools: pg.Pool[] = [];
  afterAll(() => Promise.all(pools.map((p) => p.end())));

  function limitedAuth(settings = env) {
    const pool = createAuthPool(settings.DATABASE_URL);
    pools.push(pool);
    return createAuth(settings, {
      pool,
      logger,
      rateLimit: { enabled: true, window: 60, max: 2 },
    });
  }
  const call = (auth: ReturnType<typeof limitedAuth>, headers: Record<string, string>) =>
    auth.handler(new Request('http://localhost:8787/auth/ok', { headers })).then((r) => r.status);

  it('the same IP is limited; another IP has its own limit', async () => {
    const auth = limitedAuth();
    const a = { 'x-real-ip': '203.0.113.7' };
    expect([await call(auth, a), await call(auth, a), await call(auth, a)]).toEqual([
      200, 200, 429,
    ]);
    const b = { 'x-real-ip': '198.51.100.20' };
    expect([await call(auth, b), await call(auth, b)]).toEqual([200, 200]);
    expect(await call(auth, a)).toBe(429);
  });

  // Better Auth's memory store is per process, so each test uses its own client IPs.
  it('a faked X-Forwarded-For does not give a client a fresh limit', async () => {
    const auth = limitedAuth();
    const sameClient = (n: number) => ({
      'x-real-ip': '203.0.113.99',
      'x-forwarded-for': `10.0.0.${n}`,
    });
    expect(await call(auth, sameClient(1))).toBe(200);
    expect(await call(auth, sameClient(2))).toBe(200);
    expect(await call(auth, sameClient(3))).toBe(429);
  });

  it('without CLIENT_IP_HEADER every client shares one bucket (the staging bug)', async () => {
    const auth = limitedAuth({ ...env, CLIENT_IP_HEADER: undefined });
    expect(await call(auth, { 'x-real-ip': '192.0.2.1' })).toBe(200);
    expect(await call(auth, { 'x-real-ip': '192.0.2.2' })).toBe(200);
    expect(await call(auth, { 'x-real-ip': '192.0.2.3' })).toBe(429);
  });
});
