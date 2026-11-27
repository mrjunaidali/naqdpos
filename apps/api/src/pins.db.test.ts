// Owner PIN reset by email code, end to end against naqdpos_test (run by `pnpm db:test`).
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPin } from '@naqdpos/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
/** Owner role on naqdpos_test, for fixtures and reading audit_log (no client access). */
const admin = new pg.Pool({
  connectionString: (() => {
    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    url.pathname = new URL(env.DATABASE_URL).pathname;
    return url.toString();
  })(),
  max: 2,
});

/** Every code sent, in order: [email, otp, type, language]. */
const sent: [string, string, string, string][] = [];
const lastCode = (email: string, type = 'email-verification') =>
  sent.filter(([e, , t]) => e === email && t === type).at(-1)?.[1];
const auth = createAuth(env, {
  pool: authPool,
  logger,
  sendOtp: (email, otp, type, language) => {
    sent.push([email, otp, type, language]);
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

let pinHash: string;
beforeAll(async () => {
  pinHash = await hashPin('7391', { iterations: 1000 });
});
afterAll(async () => {
  await Promise.all([db.destroy(), authPool.end(), admin.end()]);
});

const jsonHeaders = { 'content-type': 'application/json' };
const post = (path: string, body: unknown, token?: string, extra: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      ...(token && { authorization: `Bearer ${token}` }),
      ...extra,
    },
    body: JSON.stringify(body),
  });

async function signIn(email = `user-${randomUUID()}@example.test`) {
  await post('/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const res = await post('/auth/sign-in/email-otp', { email, otp: lastCode(email, 'sign-in') });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id, email };
}

/** A signed-in owner with a shop; create_shop links the owner's staff row to the user. */
async function owner() {
  const user = await signIn();
  const shop = {
    shop_id: randomUUID(),
    name: 'Ali Fruit',
    type: 'fruit_veg',
    shop_phone: '+923001234567',
    owner_staff_id: randomUUID(),
    owner_name: 'Ali',
    owner_phone: '+923001234567',
    owner_pin_hash: await hashPin('4821', { iterations: 1000 }),
  };
  expect((await post('/shops', shop, user.token)).status).toBe(201);
  return { ...user, shopId: shop.shop_id, staffId: shop.owner_staff_id };
}

const requestCode = (staffId: string, token: string) =>
  post(`/staff/${staffId}/pin-code`, {}, token);
const reset = (staffId: string, code: string | undefined, token: string) =>
  post(`/staff/${staffId}/pin`, { code, pin_hash: pinHash }, token);
const auditFor = async (staffId: string) =>
  (
    await admin.query<{ action: string; payload: unknown }>(
      `select action, payload from audit_log where entity_id = $1 and action like 'pin.%' order by at`,
      [staffId],
    )
  ).rows;

describe('owner PIN reset by email code', () => {
  it('create_shop links the owner staff row to the signed-in user (no backfill needed)', async () => {
    const o = await owner();
    const { rows } = await admin.query(`select membership_user_id from staff where id = $1`, [
      o.staffId,
    ]);
    expect(rows).toEqual([{ membership_user_id: o.userId }]);
  });

  it('emails a "PIN reset" code to the session’s email, then saves the new PIN', async () => {
    const o = await owner();
    const sentBefore = sent.length;
    const res = await requestCode(o.staffId, o.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(sent.slice(sentBefore)).toEqual([
      [o.email, expect.stringMatching(/^\d{6}$/), 'email-verification', 'en'],
    ]);

    const done = await reset(o.staffId, lastCode(o.email), o.token);
    expect(done.status).toBe(200);
    const row = (await done.json()) as { staff_id: string; pin_hash: string; server_seq: number };
    expect(row).toMatchObject({ staff_id: o.staffId, pin_hash: pinHash });
    expect(typeof row.server_seq).toBe('number');

    const audit = await auditFor(o.staffId);
    expect(audit.map((a) => a.action)).toEqual(['pin.code_sent', 'pin.reset']);
    expect(audit[1]?.payload).toEqual({ staff_id: o.staffId });
    const text = JSON.stringify(audit);
    expect(text).not.toContain(lastCode(o.email)!);
    expect(text).not.toContain('pbkdf2');
  });

  it('codes come in the app language (X-App-Language), English without it', async () => {
    const o = await owner();
    expect(sent.filter(([e]) => e === o.email).at(-1)?.[3]).toBe('en');
    const ur = { 'x-app-language': 'ur' };
    expect((await post(`/staff/${o.staffId}/pin-code`, {}, o.token, ur)).status).toBe(200);
    expect(sent.at(-1)).toEqual([o.email, expect.any(String), 'email-verification', 'ur']);

    const email = `user-${randomUUID()}@example.test`;
    await post('/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }, undefined, ur);
    expect(sent.at(-1)).toEqual([email, expect.any(String), 'sign-in', 'ur']);
  });

  it('refuses a reused code', async () => {
    const o = await owner();
    await requestCode(o.staffId, o.token);
    const code = lastCode(o.email);
    expect((await reset(o.staffId, code, o.token)).status).toBe(200);
    const again = await reset(o.staffId, code, o.token);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'invalid_code' });
  });

  it('refuses a wrong code, and stops after too many wrong tries', async () => {
    const o = await owner();
    await requestCode(o.staffId, o.token);
    const wrong = lastCode(o.email) === '000000' ? '111111' : '000000';
    const first = await reset(o.staffId, wrong, o.token);
    expect(first.status).toBe(400);
    expect(await first.json()).toMatchObject({ error: 'invalid_code' });
    await reset(o.staffId, wrong, o.token);
    await reset(o.staffId, wrong, o.token);
    const locked = await reset(o.staffId, lastCode(o.email), o.token);
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: 'too_many_attempts' });
  });

  it('refuses an expired code', async () => {
    const o = await owner();
    await requestCode(o.staffId, o.token);
    await authPool.query(
      `update verifications set expires_at = now() - interval '1 minute' where identifier like '%' || $1`,
      [o.email],
    );
    const res = await reset(o.staffId, lastCode(o.email), o.token);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'code_expired' });
  });

  it('limits code requests: one per minute, ten per day', async () => {
    const o = await owner();
    expect((await requestCode(o.staffId, o.token)).status).toBe(200);
    const soon = await requestCode(o.staffId, o.token);
    expect(soon.status).toBe(429);
    expect(await soon.json()).toMatchObject({ error: 'code_cooldown' });

    // Nine more earlier today (ten in all), none in the last minute.
    await admin.query(
      `update audit_log set at = now() - interval '2 minutes' where actor_user_id = $1 and action = 'pin.code_sent'`,
      [o.userId],
    );
    await admin.query(
      `insert into audit_log (shop_id, actor_user_id, action, entity, entity_id, at)
       select $1, $2, 'pin.code_sent', 'staff', $3, now() - (n || ' minutes')::interval
       from generate_series(3, 11) n`,
      [o.shopId, o.userId, o.staffId],
    );
    const capped = await requestCode(o.staffId, o.token);
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ error: 'code_daily_cap' });
  });

  it('refuses cashiers, riders, other shops’ owners and unlinked owner rows, without sending', async () => {
    const o = await owner();
    const cashier = await signIn();
    const rider = await signIn();
    const other = await owner();
    const cashierStaff = randomUUID();
    const riderStaff = randomUUID();
    const unlinkedOwner = randomUUID();
    await admin.query(
      `insert into memberships (shop_id, user_id, role) values ($1, $2, 'cashier'), ($1, $3, 'rider')`,
      [o.shopId, cashier.userId, rider.userId],
    );
    await admin.query(
      `insert into staff (id, shop_id, name, role, membership_user_id) values
         ($1, $4, 'Cashier', 'cashier', $5), ($2, $4, 'Rider', 'rider', $6), ($3, $4, 'Partner', 'owner', null)`,
      [cashierStaff, riderStaff, unlinkedOwner, o.shopId, cashier.userId, rider.userId],
    );
    const sentBefore = sent.length;
    const cases: [string, string][] = [
      [cashierStaff, cashier.token],
      [o.staffId, cashier.token],
      [riderStaff, rider.token],
      [o.staffId, other.token],
      [unlinkedOwner, o.token],
    ];
    for (const [staffId, token] of cases) {
      expect((await requestCode(staffId, token)).status, staffId).toBe(403);
      expect((await reset(staffId, '123456', token)).status, staffId).toBe(403);
    }
    expect(sent.length).toBe(sentBefore);
  });

  it('needs a session and valid input', async () => {
    const o = await owner();
    expect((await post(`/staff/${o.staffId}/pin-code`, {})).status).toBe(401);
    expect(
      (await post(`/staff/${o.staffId}/pin`, { code: '12', pin_hash: pinHash }, o.token)).status,
    ).toBe(400);
    expect(
      (await post(`/staff/${o.staffId}/pin`, { code: '123456', pin_hash: '7391' }, o.token)).status,
    ).toBe(400);
  });
});
