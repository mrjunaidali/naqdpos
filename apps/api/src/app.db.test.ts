// End to end against naqdpos_test (run by `pnpm db:test`): Better Auth sign-in, bearer and
// one-time tokens, then the tenant routes as that user with RLS applying.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hashPin,
  isSyncTable,
  MeResponse,
  SYNC_TABLES,
  type SyncPullResponse,
} from '@naqdpos/core';
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
      pins: (
        await sql<{
          staff_id: string;
          pin_hash: string;
        }>`select staff_id, pin_hash from staff_pins`.execute(tx)
      ).rows,
    }));
    expect(rows.shops).toEqual([{ id: shop.shop_id, phone: '+923001234567' }]);
    expect(rows.staff).toEqual([
      // PIN hashes live in staff_pins (migration 20261120170000)
      { id: shop.owner_staff_id, role: 'owner', phone: '+923001234567', pin_hash: null },
    ]);
    expect(rows.pins).toEqual([{ staff_id: shop.owner_staff_id, pin_hash: pinHash }]);
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
      cashier_max_discount_pct: 10,
      receipt_language: 'en',
      paper_width_mm: 58,
      timezone: 'Asia/Karachi',
    });
    expect(typeof entry?.shop.server_seq).toBe('number');
    expect(entry?.staff).toMatchObject({
      id: shop.owner_staff_id,
      membership_user_id: userId,
      pin_hash: null,
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

describe('/sync/push and /sync/pull', () => {
  /** An owner with a shop and a registered device in the given mode. */
  async function device(mode: 'owner' | 'shop') {
    const o = await owner();
    const id = randomUUID();
    const res = await post(
      '/devices',
      { id, shop_id: o.shop.shop_id, name: 'Phone', mode },
      o.token,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ mode });
    const headers = { ...bearer(o.token), 'x-device-id': id, 'x-app-version': '0.0.0' };
    return { ...o, deviceId: id, headers };
  }

  const pullPage = async (d: Awaited<ReturnType<typeof device>>, since: number) => {
    const res = await app.request(`/sync/pull?device_id=${d.deviceId}&since_seq=${since}`, {
      headers: d.headers,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      rows: { table: string; row: Record<string, unknown> }[];
      next_seq: number;
      has_more: boolean;
    };
  };

  it('pushes a staff row, then pulls it back with a server_seq', async () => {
    const d = await device('shop');
    const now = new Date().toISOString();
    const staffId = randomUUID();
    const entry = {
      id: randomUUID(),
      table: 'staff',
      op: 'upsert',
      actor_staff_id: d.shop.owner_staff_id,
      row: {
        id: staffId,
        shop_id: d.shop.shop_id,
        name: 'Bilal',
        phone: null,
        role: 'cashier',
        pin_hash: null,
        membership_user_id: null,
        active: true,
        device_id: d.deviceId,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        server_seq: null,
      },
    };
    const body = { device_id: d.deviceId, entries: [entry] };
    const push = () =>
      app.request('/sync/push', { method: 'POST', headers: d.headers, body: JSON.stringify(body) });
    const first = await push();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ accepted: [entry.id], conflicts: [], errors: [] });
    expect(await (await push()).json()).toEqual({
      accepted: [entry.id],
      conflicts: [],
      errors: [],
    });

    const page = await pullPage(d, 0);
    expect(page.has_more).toBe(false);
    const pulled = page.rows.find((r) => r.table === 'staff' && r.row.id === staffId);
    expect(pulled?.row.name).toBe('Bilal');
    expect(typeof pulled?.row.server_seq).toBe('number');
    expect(new Set(page.rows.map((r) => r.table))).toEqual(
      new Set(['shops', 'staff', 'staff_pins', 'devices', 'payment_methods', 'expense_categories']),
    );
    expect((await pullPage(d, page.next_seq)).rows).toEqual([]);
  });

  it('turns a row that fails its schema into a per-entry invalid error', async () => {
    const d = await device('owner');
    const bad = { id: randomUUID(), table: 'staff', op: 'upsert', row: { id: 'nope' } };
    const res = await app.request('/sync/push', {
      method: 'POST',
      headers: d.headers,
      body: JSON.stringify({ device_id: d.deviceId, entries: [bad] }),
    });
    const result = (await res.json()) as { errors: { id: string; code: string }[] };
    expect(result.errors).toEqual([expect.objectContaining({ id: bad.id, code: 'invalid' })]);
  });

  // Bug 2026-11-25: staging rejected an ml product as "The data was not valid".
  describe('the ml unit and the failed field', () => {
    const productEntry = (d: Awaited<ReturnType<typeof device>>, unit: string) => {
      const now = new Date().toISOString();
      return {
        id: randomUUID(),
        table: 'products',
        op: 'upsert',
        actor_staff_id: d.shop.owner_staff_id,
        row: {
          id: randomUUID(),
          shop_id: d.shop.shop_id,
          category_id: null,
          name: 'Rose water',
          name_ur: null,
          unit,
          sale_price_paisa: 5000,
          barcode: null,
          track_stock: false,
          min_qty_milli: null,
          is_combo: false,
          packaging_cost_paisa: 0,
          foc_rule: null,
          search_terms: [],
          icon: null,
          device_id: d.deviceId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          server_seq: null,
        },
      };
    };
    const pushOne = (d: Awaited<ReturnType<typeof device>>, entry: unknown) =>
      app.request('/sync/push', {
        method: 'POST',
        headers: d.headers,
        body: JSON.stringify({ device_id: d.deviceId, entries: [entry] }),
      });

    it('accepts an ml product and pulls it back, with the server units', async () => {
      const d = await device('owner');
      const entry = productEntry(d, 'ml');
      const res = await pushOne(d, entry);
      expect(await res.json()).toEqual({ accepted: [entry.id], conflicts: [], errors: [] });
      const page = (await pullPage(d, 0)) as Awaited<ReturnType<typeof pullPage>> & {
        units?: string[];
      };
      expect(page.units).toEqual(expect.arrayContaining(['kg', 'ml']));
      const pulled = page.rows.find((r) => r.table === 'products' && r.row.id === entry.row.id);
      expect(pulled?.row.unit).toBe('ml');
    });

    it('names the field on a schema rejection (API) and on a database one (sync_push)', async () => {
      const d = await device('owner');
      const tooLong = productEntry(d, 'x'.repeat(17));
      const api = (await (await pushOne(d, tooLong)).json()) as { errors: unknown[] };
      expect(api.errors).toEqual([
        expect.objectContaining({ id: tooLong.id, code: 'invalid', field: 'unit' }),
      ]);
      const unknown = productEntry(d, 'ton');
      const db = (await (await pushOne(d, unknown)).json()) as { errors: unknown[] };
      expect(db.errors).toEqual([
        expect.objectContaining({ id: unknown.id, code: 'invalid', field: 'unit' }),
      ]);
    });
  });

  it('answers 403 for a device of another shop', async () => {
    const mine = await device('owner');
    const theirs = await device('owner');
    const res = await app.request(`/sync/pull?device_id=${theirs.deviceId}&since_seq=0`, {
      headers: { ...mine.headers, 'x-device-id': theirs.deviceId },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });
});

// Staging, 26 Nov 2026: GET /sync/pull answered 500 for a fresh device (since_seq=0), so a new
// phone or browser got no products or sales. Through the real API (naqdpos_app, RLS on): one
// device fills the shop, a second device registered afterwards pulls everything from 0.
describe('a fresh device pulls the whole shop from since_seq=0', () => {
  it('gets products (also ml), sales, lines, payments, khata and day closes, every row parseable', async () => {
    const o = await owner();
    const shopId = o.shop.shop_id;
    const actor = o.shop.owner_staff_id;
    const register = async (mode: 'owner' | 'shop') => {
      const id = randomUUID();
      const res = await post('/devices', { id, shop_id: shopId, name: 'Phone', mode }, o.token);
      expect(res.status).toBe(201);
      return { id, headers: { ...bearer(o.token), 'x-device-id': id, 'x-app-version': '0.0.0' } };
    };
    const first = await register('owner');
    const now = new Date().toISOString();
    const day = '2026-11-25';
    const common = { shop_id: shopId, device_id: first.id, server_seq: null };
    const mutable = { ...common, created_at: now, updated_at: now, deleted_at: null };
    const product = (name: string, unit: string, price: number) => ({
      ...mutable,
      id: randomUUID(),
      category_id: null,
      name,
      name_ur: null,
      unit,
      sale_price_paisa: price,
      barcode: null,
      track_stock: false,
      min_qty_milli: null,
      is_combo: false,
      packaging_cost_paisa: 0,
      foc_rule: null,
      search_terms: [],
      icon: null,
    });
    const tomato = product('Tomato', 'kg', 16_000);
    const roseWater = product('Rose water', 'ml', 5_000);
    const customer = {
      ...mutable,
      id: randomUUID(),
      mobile: '+923001234567',
      name: 'Aslam',
      address: null,
      credit_limit_paisa: null,
      whatsapp_opt_in: false,
    };
    const saleId = randomUUID();
    const sale = {
      ...common,
      id: saleId,
      receipt_no: 'A1-000001',
      business_date: day,
      staff_id: actor,
      customer_id: customer.id,
      order_type: 'walk_in',
      source: 'walk_in',
      subtotal_paisa: 46_000,
      discount_paisa: 0,
      rounding_paisa: 0,
      total_paisa: 46_000,
      note: null,
      discount_approved_by_staff_id: null,
      created_at: now,
    };
    const line = (p: typeof tomato, qty: number, total: number) => ({
      ...common,
      id: randomUUID(),
      sale_id: saleId,
      product_id: p.id,
      name_snapshot: p.name,
      name_ur_snapshot: null,
      unit_snapshot: p.unit,
      qty_milli: qty,
      unit_price_paisa: p.sale_price_paisa,
      discount_paisa: 0,
      is_foc: false,
      by_amount: false,
      line_total_paisa: total,
      created_at: now,
    });
    const payment = {
      ...common,
      id: randomUUID(),
      business_date: day,
      kind: 'sale',
      sale_id: saleId,
      customer_id: null,
      method_code: 'cash',
      amount_paisa: 16_000,
      reference: null,
      staff_id: actor,
      created_at: now,
    };
    const credit = {
      ...common,
      id: randomUUID(),
      customer_id: customer.id,
      business_date: day,
      type: 'credit_sale',
      amount_paisa: 30_000,
      sale_id: saleId,
      payment_id: null,
      note: null,
      staff_id: actor,
      created_at: now,
    };
    const close = {
      ...common,
      id: randomUUID(),
      business_date: day,
      opening_cash_paisa: 0,
      expected_cash_paisa: 16_000,
      counted_cash_paisa: 16_000,
      difference_paisa: 0,
      owner_withdrawal_paisa: 0,
      note: null,
      closed_by_staff_id: actor,
      closed_at: now,
      seen_through_seq: 0,
    };
    const entry = (table: string, row: object, op = 'insert') => ({
      id: randomUUID(),
      table,
      op,
      actor_staff_id: actor,
      row,
    });
    const entries = [
      entry('products', tomato, 'upsert'),
      entry('products', roseWater, 'upsert'),
      entry('customers', customer, 'upsert'),
      entry('sales', sale),
      // 1 kg tomato Rs 160 + 6 ml rose water at Rs 50 = Rs 300 (on khata)
      entry('sale_lines', line(tomato, 1000, 16_000)),
      entry('sale_lines', line(roseWater, 6000, 30_000)),
      entry('payments', payment),
      entry('khata_entries', credit),
      entry('day_closes', close),
    ];
    const pushed = await app.request('/sync/push', {
      method: 'POST',
      headers: first.headers,
      body: JSON.stringify({ device_id: first.id, entries }),
    });
    expect(pushed.status).toBe(200);
    expect(await pushed.json()).toMatchObject({ errors: [], conflicts: [] });

    for (const mode of ['owner', 'shop'] as const) {
      const fresh = await register(mode);
      const rows: { table: string; row: Record<string, unknown> }[] = [];
      let since = 0;
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        const res = await app.request(
          // The app's default page (500) on the owner device; tiny pages on the shop device.
          `/sync/pull?device_id=${fresh.id}&since_seq=${since}${mode === 'shop' ? '&limit=3' : ''}`,
          { headers: fresh.headers },
        );
        const body = (await res.json()) as SyncPullResponse & { error?: string };
        expect(res.status, `${mode} page ${pageNo}: ${JSON.stringify(body)}`).toBe(200);
        expect(body.units).toEqual(expect.arrayContaining(['ml']));
        rows.push(...body.rows);
        if (!body.has_more) break;
        since = body.next_seq;
      }
      const tables = new Set(rows.map((r) => r.table));
      for (const t of [
        'products',
        'customers',
        'sales',
        'sale_lines',
        'payments',
        'khata_entries',
        'day_closes',
      ])
        expect(tables.has(t), `${mode}: ${t}`).toBe(true);
      // What the app would store: every pulled row passes its table's schema.
      for (const { table, row } of rows) {
        if (!isSyncTable(table)) continue;
        const parsed = SYNC_TABLES[table].schema.safeParse(row);
        expect(parsed.success, `${mode}: ${table} ${JSON.stringify(row)}`).toBe(true);
      }
      expect(
        rows
          .filter((r) => r.table === 'sale_lines')
          .map((r) => r.row.unit_snapshot)
          .sort(),
      ).toEqual(['kg', 'ml']);
    }
  });
});

describe('POST /devices/{id}/mode', () => {
  async function ownerWithDevice() {
    const o = await owner();
    const id = randomUUID();
    expect(
      (await post('/devices', { id, shop_id: o.shop.shop_id, name: 'Counter' }, o.token)).status,
    ).toBe(201);
    return { ...o, deviceId: id };
  }

  it('lets the owner switch the device to owner phone and back', async () => {
    const o = await ownerWithDevice();
    const toOwner = await post(`/devices/${o.deviceId}/mode`, { mode: 'owner' }, o.token);
    expect(toOwner.status).toBe(200);
    expect(await toOwner.json()).toMatchObject({ id: o.deviceId, mode: 'owner' });
    const retry = await post(`/devices/${o.deviceId}/mode`, { mode: 'owner' }, o.token);
    expect(await retry.json()).toMatchObject({ mode: 'owner' });
    const back = await post(`/devices/${o.deviceId}/mode`, { mode: 'shop' }, o.token);
    expect(await back.json()).toMatchObject({ mode: 'shop' });
  });

  it("refuses another user's device and an unknown device with 403", async () => {
    const o = await ownerWithDevice();
    const other = await signIn();
    expect((await post(`/devices/${o.deviceId}/mode`, { mode: 'owner' }, other.token)).status).toBe(
      403,
    );
    expect((await post(`/devices/${randomUUID()}/mode`, { mode: 'owner' }, o.token)).status).toBe(
      403,
    );
  });
});
