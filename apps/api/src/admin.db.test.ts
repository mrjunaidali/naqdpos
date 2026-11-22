// Admin portal API end to end against naqdpos_test (run by `pnpm db:test`): sign-in, 2FA
// enrolment and verification per session, the 12-hour admin session, shops and status.
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb } from './db/index.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

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
const adminUrl = new URL(process.env.DATABASE_ADMIN_URL!);
adminUrl.pathname = '/naqdpos_test';
const owner = new pg.Pool({ connectionString: adminUrl.toString() });
const otps = new Map<string, string>();
const auth = createAuth(env, {
  pool: authPool,
  logger,
  sendOtp: (email, otp) => {
    otps.set(email, otp);
    return Promise.resolve();
  },
});
const app = createApp({
  db,
  auth,
  logger,
  origins: env.APP_ORIGINS,
  checkDb: () => Promise.resolve(true),
});

afterAll(async () => {
  await Promise.all([db.destroy(), authPool.end(), owner.end()]);
});

const jsonHeaders = { 'content-type': 'application/json' };
const bearer = (token: string) => ({ ...jsonHeaders, authorization: `Bearer ${token}` });

async function signIn(email: string) {
  await app.request('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const res = await app.request('/auth/sign-in/email-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, otp: otps.get(email) }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret, as an authenticator app does. */
function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

const get = (path: string, token: string) => app.request(path, { headers: bearer(token) });
const post = (path: string, token: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: bearer(token), body: JSON.stringify(body) });

async function grant(email: string) {
  await owner.query('select admin_grant($1)', [email]);
}

describe('/admin/* (US010, US011)', () => {
  it('401 without a session; 403 for a normal owner', async () => {
    expect((await app.request('/admin/shops')).status).toBe(401);
    const token = await signIn(`owner-${randomUUID()}@example.test`);
    expect((await get('/admin/shops', token)).status).toBe(403);
    expect(await (await get('/admin/me', token)).json()).toMatchObject({ state: 'admin_required' });
    expect((await post('/admin/2fa/enroll', token, {})).status).toBe(403);
  });

  it('an admin enrols 2FA, then each new session needs a code; backup codes work; then the shops', async () => {
    const email = `admin-${randomUUID()}@example.test`;
    const first = await signIn(email);
    await grant(email);

    // Admin without 2FA: enrol first, nothing else.
    expect(await (await get('/admin/me', first)).json()).toMatchObject({
      state: 'two_factor_setup',
    });
    expect((await get('/admin/shops', first)).status).toBe(403);
    const enroll = (await (await post('/admin/2fa/enroll', first, {})).json()) as {
      totp_uri: string;
      secret: string;
      backup_codes: string[];
    };
    expect(enroll.totp_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(enroll.backup_codes.length).toBeGreaterThan(0);
    expect((await post('/admin/2fa/verify', first, { code: '000000' })).status).toBe(400);
    const verified = await post('/admin/2fa/verify', first, { code: totp(enroll.secret) });
    expect(verified.status).toBe(200);
    // 2FA turned on: Better Auth replaced the session; the old token no longer works.
    const { token: renewed } = (await verified.json()) as { token: string };
    expect(renewed).toBeTruthy();
    expect((await get('/admin/me', first)).status).toBe(401);
    expect(await (await get('/admin/me', renewed)).json()).toMatchObject({ state: 'ok' });
    expect((await get('/admin/shops', renewed)).status).toBe(200);

    // A new session (2FA on): blocked until this session is verified too.
    const second = await signIn(email);
    expect(await (await get('/admin/me', second)).json()).toMatchObject({
      state: 'two_factor_required',
    });
    expect((await get('/admin/shops', second)).status).toBe(403);
    expect(
      (await post('/admin/2fa/verify', second, { backup_code: enroll.backup_codes[0] })).status,
    ).toBe(200);
    const list = await get('/admin/shops?page=1', second);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { rows: { id: string }[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(0);

    // Suspend and reactivate a shop through the API (reason required).
    const shop = body.rows[0];
    if (shop) {
      expect(
        (await post(`/admin/shops/${shop.id}/status`, second, { status: 'suspended', reason: '' }))
          .status,
      ).toBe(400);
      const res = await post(`/admin/shops/${shop.id}/status`, second, {
        status: 'suspended',
        reason: 'test',
      });
      expect(res.status).toBe(200);
      const detail = (await (await get(`/admin/shops/${shop.id}`, second)).json()) as {
        shop: { status: string };
        audit: { action: string; acting_as_admin: boolean }[];
      };
      expect(detail.shop.status).toBe('suspended');
      expect(detail.audit[0]).toMatchObject({ action: 'shop.suspend', acting_as_admin: true });
      expect(
        (
          await post(`/admin/shops/${shop.id}/status`, second, {
            status: 'active',
            reason: 'test done',
          })
        ).status,
      ).toBe(200);
    }
    expect((await get(`/admin/shops/${randomUUID()}`, second)).status).toBe(404);
  });

  it('admin sessions older than 12 hours are refused with 401', async () => {
    const email = `admin-${randomUUID()}@example.test`;
    const token = await signIn(email);
    await grant(email);
    const enroll = (await (await post('/admin/2fa/enroll', token, {})).json()) as {
      secret: string;
    };
    const verified = await post('/admin/2fa/verify', token, { code: totp(enroll.secret) });
    const { token: renewed } = (await verified.json()) as { token: string };
    expect((await get('/admin/shops', renewed)).status).toBe(200);
    await owner.query(
      `update sessions set created_at = now() - interval '13 hours'
       where user_id = (select id from users where email = $1)`,
      [email],
    );
    const res = await get('/admin/shops', renewed);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ message: 'session_expired' });
  });
});
