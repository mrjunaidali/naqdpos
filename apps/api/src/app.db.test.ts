// End to end against naqdpos_test (run by `pnpm db:test`): Better Auth sign-in, bearer and
// one-time tokens, then the tenant routes as that user with RLS applying.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPin, MeResponse } from '@naqdpos/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createAuth, createAuthPool, type AuthService } from './auth.ts';
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
const sendOtp = (email: string, otp: string) => {
  otps.set(email, otp);
  return Promise.resolve();
};
const auth = createAuth(env, { pool: authPool, logger, sendOtp });

function makeApp(authService: AuthService) {
  return createApp({
    db,
    auth: authService,
    logger,
    origins: env.APP_ORIGINS,
    checkDb: () => Promise.resolve(true),
  });
}
const app = makeApp(auth);

let pinHash: string;
beforeAll(async () => {
  pinHash = await hashPin('4821', { iterations: 1000 });
});
afterAll(async () => {
  await Promise.all([db.destroy(), authPool.end()]);
});

const jsonHeaders = { 'content-type': 'application/json' };
const bearer = (token: string) => ({ ...jsonHeaders, authorization: `Bearer ${token}` });

async function signIn(email = `owner-${randomUUID()}@example.test`) {
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
  const body = (await res.json()) as { token: string; user: { id: string } };
  expect(body.token).toBeTruthy();
  return { token: body.token, userId: body.user.id, email };
}

function newShop() {
  return {
    shop_id: randomUUID(),
    name: 'Ali Fruit & Veg',
    type: 'fruit_veg',
    shop_phone: '+923001234567',
    address: 'Saddar, Karachi',
    owner_staff_id: randomUUID(),
    owner_name: 'Ali',
    owner_phone: '+923001234567',
    owner_pin_hash: pinHash,
  };
}

function post(path: string, body: unknown, token?: string, extra: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { ...(token ? bearer(token) : jsonHeaders), ...extra },
    body: JSON.stringify(body),
  });
}

/** A signed-in owner with a shop. */
async function owner() {
  const user = await signIn();
  const shop = newShop();
  expect((await post('/shops', shop, user.token)).status).toBe(201);
  return { ...user, shop };
}

describe('email OTP sign-in', () => {
  it('creates a user and returns a bearer token that resolves to it', async () => {
    const { token, userId } = await signIn();
    expect(await auth.getUser(new Headers({ authorization: `Bearer ${token}` }))).toMatchObject({
      id: userId,
    });
  });

  it('rejects a wrong code', async () => {
    const email = `wrong-${randomUUID()}@example.test`;
    await post('/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    const wrong = otps.get(email) === '000000' ? '111111' : '000000';
    const res = await post('/auth/sign-in/email-otp', { email, otp: wrong });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(((await res.json()) as { token?: string }).token).toBeUndefined();
  });

  it('issues sessions that last about 90 days', async () => {
    const { token } = await signIn();
    const res = await app.request('/auth/get-session', { headers: bearer(token) });
    const { session } = (await res.json()) as { session: { expiresAt: string } };
    const days = (new Date(session.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);
  });
});

describe('one-time tokens (Google sign-in hand-off)', () => {
  const verify = (token: string) => post('/auth/one-time-token/verify', { token });

  it('trade once for the bearer session token, without setting a cookie', async () => {
    const { token, userId } = await signIn();
    const ott = await auth.createOneTimeToken(token);

    const res = await verify(ott);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    const body = (await res.json()) as { session: { token: string }; user: { id: string } };
    expect(body.user.id).toBe(userId);
    // The exchanged token works as a bearer token.
    const me = await app.request('/me', { headers: bearer(body.session.token) });
    expect(me.status).toBe(200);
  });

  it('cannot be reused', async () => {
    const { token } = await signIn();
    const ott = await auth.createOneTimeToken(token);
    expect((await verify(ott)).status).toBe(200);
    const again = await verify(ott);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ message: 'Invalid token' });
  });

  it('expires quickly', async () => {
    // Same database, a lifetime of 0.6 seconds instead of 1 minute.
    const shortAuth = createAuth(env, {
      pool: authPool,
      logger,
      sendOtp,
      oneTimeTokenMinutes: 0.01,
    });
    const { token } = await signIn();
    const ott = await shortAuth.createOneTimeToken(token);
    await new Promise((r) => setTimeout(r, 900));
    const res = await makeApp(shortAuth).request('/auth/one-time-token/verify', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ token: ott }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects made-up tokens', async () => {
    expect((await verify('not-a-token')).status).toBe(400);
  });

  it('cannot be minted by a client, only by the server', async () => {
    const { token } = await signIn();
    const res = await app.request('/auth/one-time-token/generate', { headers: bearer(token) });
    expect(res.status).toBe(400);
  });

  it('is stored hashed, not as the token itself', async () => {
    const { token } = await signIn();
    const ott = await auth.createOneTimeToken(token);
    const { rows } = await authPool.query<{ identifier: string }>(
      `select identifier from verifications where identifier like 'one-time-token:%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.identifier.includes(ott))).toBe(false);
  });
});

describe('POST /shops', () => {
  it('creates the shop, owner membership and owner staff with the PIN hash', async () => {
    const { token, userId } = await signIn();
    const shop = newShop();
    const res = await post('/shops', shop, token);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: shop.shop_id });

    const rows = await withUserTx(db, { userId }, async (tx) => ({
      shops: await tx.selectFrom('shops').select(['id', 'phone']).execute(),
      staff: await tx.selectFrom('staff').select(['id', 'role', 'phone', 'pin_hash']).execute(),
    }));
    expect(rows.shops).toEqual([{ id: shop.shop_id, phone: '+923001234567' }]);
    expect(rows.staff).toEqual([
      { id: shop.owner_staff_id, role: 'owner', phone: '+923001234567', pin_hash: pinHash },
    ]);
  });

  it('a retry returns 201 with the same id', async () => {
    const { token } = await signIn();
    const shop = newShop();
    expect((await post('/shops', shop, token)).status).toBe(201);
    const retry = await post('/shops', shop, token);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({ id: shop.shop_id });
  });

  it('another user reusing a shop id gets 409 and cannot see that shop', async () => {
    const first = await owner();
    const second = await signIn();
    const res = await post('/shops', { ...first.shop, owner_staff_id: randomUUID() }, second.token);
    expect(res.status).toBe(409);
    const visible = await withUserTx(db, { userId: second.userId }, (tx) =>
      sql`select 1 from shops where id = ${first.shop.shop_id}`.execute(tx),
    );
    expect(visible.rows).toHaveLength(0);
  });

  it('needs a valid session', async () => {
    expect((await post('/shops', newShop())).status).toBe(401);
    expect((await post('/shops', newShop(), 'not-a-real-token')).status).toBe(401);
  });

  it('rejects invalid input', async () => {
    const { token } = await signIn();
    expect((await post('/shops', { ...newShop(), type: 'bakery' }, token)).status).toBe(400);
    expect((await post('/shops', { ...newShop(), owner_pin_hash: '4821' }, token)).status).toBe(
      400,
    );
  });
});

describe('GET /me', () => {
  it('returns the user with no shops before onboarding', async () => {
    const { token, userId, email } = await signIn();
    const res = await app.request('/me', { headers: bearer(token) });
    expect(res.status).toBe(200);
    const me = MeResponse.parse(await res.json());
    expect(me.user).toMatchObject({ id: userId, email });
    expect(me.shops).toEqual([]);
  });

  it("returns the owner's shop and own staff row, in the shared contract", async () => {
    const { token, userId, shop } = await owner();
    const me = MeResponse.parse(
      await (await app.request('/me', { headers: bearer(token) })).json(),
    );
    expect(me.shops).toHaveLength(1);
    const [entry] = me.shops;
    expect(entry?.role).toBe('owner');
    expect(entry?.shop).toMatchObject({
      id: shop.shop_id,
      name: shop.name,
      cashier_expense_limit_paisa: 200_000,
      timezone: 'Asia/Karachi',
    });
    expect(typeof entry?.shop.server_seq).toBe('number');
    expect(entry?.staff).toMatchObject({
      id: shop.owner_staff_id,
      membership_user_id: userId,
      pin_hash: pinHash,
    });
  });

  it("never returns another owner's shop", async () => {
    await owner();
    const { token } = await signIn();
    const me = MeResponse.parse(
      await (await app.request('/me', { headers: bearer(token) })).json(),
    );
    expect(me.shops).toEqual([]);
  });
});

describe('POST /devices', () => {
  it('registers devices with codes A1, A2 for the owner', async () => {
    const { token, userId, shop } = await owner();
    const first = { id: randomUUID(), shop_id: shop.shop_id, name: 'Owner phone' };
    const res = await post('/devices', first, token);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: first.id,
      shop_id: shop.shop_id,
      name: 'Owner phone',
      code: 'A1',
      registered_by: userId,
      last_seq_pulled: 0,
    });
    const second = await post(
      '/devices',
      { id: randomUUID(), shop_id: shop.shop_id, name: 'Counter' },
      token,
    );
    expect(await second.json()).toMatchObject({ code: 'A2' });
  });

  it('a retry returns the same device and code', async () => {
    const { token, shop } = await owner();
    const device = { id: randomUUID(), shop_id: shop.shop_id, name: 'Phone' };
    const first = (await (await post('/devices', device, token)).json()) as { code: string };
    const retry = await post('/devices', device, token);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toMatchObject({ code: first.code });
  });

  it("refuses another user's shop with 403", async () => {
    const { shop } = await owner();
    const other = await signIn();
    const res = await post(
      '/devices',
      { id: randomUUID(), shop_id: shop.shop_id, name: 'Phone' },
      other.token,
    );
    expect(res.status).toBe(403);
  });

  it('a device id registered to another shop gets 409', async () => {
    const a = await owner();
    const b = await owner();
    const id = randomUUID();
    expect(
      (await post('/devices', { id, shop_id: a.shop.shop_id, name: 'P' }, a.token)).status,
    ).toBe(201);
    expect(
      (await post('/devices', { id, shop_id: b.shop.shop_id, name: 'P' }, b.token)).status,
    ).toBe(409);
  });

  it('needs a session and valid input', async () => {
    const body = { id: randomUUID(), shop_id: randomUUID(), name: 'Phone' };
    expect((await post('/devices', body)).status).toBe(401);
    const { token } = await signIn();
    expect((await post('/devices', { ...body, name: '' }, token)).status).toBe(400);
  });
});

describe('app.device_id', () => {
  it('is set in the transaction when the request names a device, and empty otherwise', async () => {
    const userId = randomUUID();
    const deviceId = randomUUID();
    const read = (ctx: { userId: string; deviceId?: string }) =>
      withUserTx(db, ctx, async (tx) => {
        const { rows } = await sql<{ device: string | null }>`
          select current_setting('app.device_id', true) as device`.execute(tx);
        return rows[0]?.device;
      });
    expect(await read({ userId, deviceId })).toBe(deviceId);
    expect(await read({ userId })).toBe('');
  });
});
