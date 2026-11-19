// End to end against naqdpos_test (run by `pnpm db:test`): email OTP sign-in through Better Auth,
// a bearer session token, then POST /shops as that user with RLS applying.
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb, withUserTx } from './db/index.ts';
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
  await Promise.all([db.destroy(), authPool.end()]);
});

const jsonHeaders = { 'content-type': 'application/json' };

async function signIn(email: string): Promise<{ token: string; userId: string }> {
  const sent = await app.request('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  expect(sent.status).toBe(200);
  const otp = otps.get(email);
  expect(otp).toMatch(/^\d{6}$/);

  const res = await app.request('/auth/sign-in/email-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, otp }),
  });
  expect(res.status).toBe(200);
  const token = res.headers.get('set-auth-token');
  expect(token).toBeTruthy();
  const body = (await res.json()) as { user: { id: string } };
  return { token: token!, userId: body.user.id };
}

function newShop() {
  return {
    shop_id: randomUUID(),
    name: 'Ali Fruit & Veg',
    type: 'fruit_veg',
    shop_phone: '03001234567',
    address: 'Saddar, Karachi',
    owner_staff_id: randomUUID(),
    owner_name: 'Ali',
    owner_phone: '03007654321',
  };
}

function postShop(body: unknown, token?: string) {
  return app.request('/shops', {
    method: 'POST',
    headers: { ...jsonHeaders, ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
}

describe('email OTP sign-in', () => {
  it('creates a user and returns a bearer token that resolves to it', async () => {
    const { token, userId } = await signIn(`owner-${randomUUID()}@example.test`);
    expect(await auth.getUserId(new Headers({ authorization: `Bearer ${token}` }))).toBe(userId);
  });

  it('rejects a wrong code', async () => {
    const email = `wrong-${randomUUID()}@example.test`;
    await app.request('/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email, type: 'sign-in' }),
    });
    const wrong = otps.get(email) === '000000' ? '111111' : '000000';
    const res = await app.request('/auth/sign-in/email-otp', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email, otp: wrong }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('set-auth-token')).toBeNull();
  });
});

describe('POST /shops', () => {
  it('creates the shop, owner membership and owner staff for the signed-in user', async () => {
    const { token, userId } = await signIn(`owner-${randomUUID()}@example.test`);
    const shop = newShop();
    const res = await postShop(shop, token);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: shop.shop_id });

    // Read back as that user, through RLS.
    const rows = await withUserTx(db, userId, async (tx) => ({
      shops: await tx.selectFrom('shops').select(['id', 'name', 'type']).execute(),
      memberships: await tx.selectFrom('memberships').select(['user_id', 'role']).execute(),
      staff: await tx.selectFrom('staff').select(['id', 'role', 'membership_user_id']).execute(),
    }));
    expect(rows.shops).toEqual([{ id: shop.shop_id, name: shop.name, type: 'fruit_veg' }]);
    expect(rows.memberships).toEqual([{ user_id: userId, role: 'owner' }]);
    expect(rows.staff).toEqual([
      { id: shop.owner_staff_id, role: 'owner', membership_user_id: userId },
    ]);
  });

  it('a retry returns 201 with the same id', async () => {
    const { token } = await signIn(`owner-${randomUUID()}@example.test`);
    const shop = newShop();
    expect((await postShop(shop, token)).status).toBe(201);
    const retry = await postShop(shop, token);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({ id: shop.shop_id });
  });

  it('another user reusing a shop id gets 409 and cannot see that shop', async () => {
    const first = await signIn(`owner-${randomUUID()}@example.test`);
    const second = await signIn(`owner-${randomUUID()}@example.test`);
    const shop = newShop();
    expect((await postShop(shop, first.token)).status).toBe(201);
    const res = await postShop({ ...shop, owner_staff_id: randomUUID() }, second.token);
    expect(res.status).toBe(409);
    const visible = await withUserTx(db, second.userId, (tx) =>
      sql`select 1 from shops where id = ${shop.shop_id}`.execute(tx),
    );
    expect(visible.rows).toHaveLength(0);
  });

  it('needs a valid session', async () => {
    expect((await postShop(newShop())).status).toBe(401);
    expect((await postShop(newShop(), 'not-a-real-token')).status).toBe(401);
  });

  it('rejects invalid input', async () => {
    const { token } = await signIn(`owner-${randomUUID()}@example.test`);
    const res = await postShop({ ...newShop(), type: 'bakery' }, token);
    expect(res.status).toBe(400);
  });
});
