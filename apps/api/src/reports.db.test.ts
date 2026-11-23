// Owner report routes end to end against naqdpos_test (run by `pnpm db:test`, US047–US049, US068):
// owner only (cashier, rider and another shop's owner get 403), range checks, JSON and CSV.
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
const adminUrl = new URL(process.env.DATABASE_ADMIN_URL!);
adminUrl.pathname = '/naqdpos_test';
const ownerPool = new pg.Pool({ connectionString: adminUrl.toString() });
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

const jsonHeaders = { 'content-type': 'application/json' };
const bearer = (token: string) => ({ ...jsonHeaders, authorization: `Bearer ${token}` });

async function signIn(email = `u-${randomUUID()}@example.test`) {
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
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function ownerWithShop() {
  const user = await signIn();
  const shop = { shop_id: randomUUID(), owner_staff_id: randomUUID() };
  const res = await app.request('/shops', {
    method: 'POST',
    headers: bearer(user.token),
    body: JSON.stringify({
      ...shop,
      name: 'Report Fruit',
      type: 'fruit_veg',
      shop_phone: '+923001234567',
      owner_name: 'Ali',
      owner_phone: '+923001234567',
      owner_pin_hash: await hashPin('4821', { iterations: 1000 }),
    }),
  });
  expect(res.status).toBe(201);
  return { ...user, ...shop };
}

let owner: Awaited<ReturnType<typeof ownerWithShop>>;
const FROM = '2026-10-01';
const TO = '2026-10-31';

beforeAll(async () => {
  owner = await ownerWithShop();
  // One sale (a costed mango line and a custom item) and an expense with a comma in its note.
  const c = await ownerPool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.user_id', $1, true)`, [owner.userId]);
    const product = randomUUID();
    const sale = randomUUID();
    await c.query(
      `insert into products (id, shop_id, name, unit, sale_price_paisa, search_terms) values ($1, $2, 'Mango', 'kg', 30000, '{}')`,
      [product, owner.shop_id],
    );
    await c.query(
      `insert into product_cost_history (id, shop_id, product_id, cost_price_paisa, effective_at) values ($1, $2, $3, 20000, '2026-09-01')`,
      [randomUUID(), owner.shop_id, product],
    );
    await c.query(
      `insert into sales (id, shop_id, receipt_no, business_date, staff_id, order_type, source, subtotal_paisa,
         discount_paisa, rounding_paisa, total_paisa, created_at)
       values ($1, $2, 'A1-000001', '2026-10-05', $3, 'walk_in', 'walk_in', 110000, 0, 0, 110000, '2026-10-05T05:00:00Z')`,
      [sale, owner.shop_id, owner.owner_staff_id],
    );
    await c.query(
      `insert into sale_lines (id, shop_id, sale_id, product_id, name_snapshot, unit_snapshot, qty_milli,
         unit_price_paisa, discount_paisa, line_total_paisa, created_at) values
       ($1, $3, $4, $5, 'Mango', 'kg', 2000, 30000, 0, 60000, '2026-10-05T05:00:00Z'),
       ($2, $3, $4, null, 'Gift basket', 'piece', 1000, 50000, 0, 50000, '2026-10-05T05:00:00Z')`,
      [randomUUID(), randomUUID(), owner.shop_id, sale, product],
    );
    await c.query(
      `insert into payments (id, shop_id, business_date, kind, sale_id, method_code, amount_paisa, staff_id, created_at)
       values ($1, $2, '2026-10-05', 'sale', $3, 'cash', 110000, $4, '2026-10-05T05:00:00Z')`,
      [randomUUID(), owner.shop_id, sale, owner.owner_staff_id],
    );
    await c.query(
      `insert into expenses (id, shop_id, business_date, category_id, amount_paisa, paid_method_code, note, staff_id, created_at)
       select $1, $2, '2026-10-06', id, 25000, 'cash', 'Bags, large', $3, '2026-10-06T05:00:00Z'
       from expense_categories where shop_id = $2 order by sort limit 1`,
      [randomUUID(), owner.shop_id, owner.owner_staff_id],
    );
    await c.query('commit');
  } finally {
    c.release();
  }
});
afterAll(async () => {
  await Promise.all([db.destroy(), authPool.end(), ownerPool.end()]);
});

const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? bearer(token) : jsonHeaders });
const q = (shop: string, extra = '') => `?shop_id=${shop}&from=${FROM}&to=${TO}${extra}`;

/** Adds a user with a role (and a staff row) in the owner's shop. */
async function member(role: 'cashier' | 'rider') {
  const user = await signIn();
  await ownerPool.query('insert into memberships (shop_id, user_id, role) values ($1, $2, $3)', [
    owner.shop_id,
    user.userId,
    role,
  ]);
  await ownerPool.query(
    `insert into staff (id, shop_id, name, role, membership_user_id) values ($1, $2, 'Staff', $3, $4)`,
    [randomUUID(), owner.shop_id, role, user.userId],
  );
  return user;
}

describe('/reports/*', () => {
  it('owner: summary JSON', async () => {
    const res = await get(`/reports/summary${q(owner.shop_id)}`, owner.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sales_count: 1,
      net_sales_paisa: 110000,
      costed_sales_paisa: 60000,
      cost_of_goods_paisa: 40000,
      costed_profit_paisa: 20000,
      uncosted_sales_paisa: 50000,
      uncosted_lines: 1,
      expenses_total_paisa: 25000,
      net_paisa: 20000 - 25000,
      unclosed_days: ['2026-10-05', '2026-10-06'],
    });
  });

  it('CSV: products, staff and expenses with BOM, header, content type and file name', async () => {
    const products = await get(`/reports/products${q(owner.shop_id, '&format=csv')}`, owner.token);
    expect(products.status).toBe(200);
    expect(products.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(products.headers.get('content-disposition')).toBe(
      'attachment; filename="products-2026-10-01-2026-10-31.csv"',
    );
    // The body starts with the UTF-8 BOM (EF BB BF); Response.text() would strip it.
    const bytes = new Uint8Array(await products.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = new TextDecoder().decode(bytes).trimEnd().split('\r\n');
    expect(rows[0]).toMatch(/^product,name_ur,unit,custom_item,qty/);
    expect(rows).toContain('Mango,,kg,no,2.000,0.000,600.00,600.00,400.00,200.00,0.00');
    expect(rows).toContain('Gift basket,,piece,yes,1.000,0.000,500.00,0.00,0.00,0.00,500.00');

    const staff = await (
      await get(`/reports/staff${q(owner.shop_id, '&format=csv')}`, owner.token)
    ).text();
    expect(staff.split('\r\n')[1]).toBe('Ali,1,1100.00,0.00,0.00');

    const expenses = await (
      await get(`/reports/expenses${q(owner.shop_id, '&format=csv')}`, owner.token)
    ).text();
    expect(expenses).toContain(',250.00,cash,"Bags, large",,Ali,,');

    // JSON stays the default.
    const json = await get(`/reports/products${q(owner.shop_id)}`, owner.token);
    expect(json.headers.get('content-type')).toContain('application/json');
  });

  it('expense filters reach SQL', async () => {
    const res = await get(
      `/reports/expenses${q(owner.shop_id, '&method_code=jazzcash')}`,
      owner.token,
    );
    expect(((await res.json()) as { total_paisa: number }).total_paisa).toBe(0);
  });

  it('cashier, rider and another shop owner get 403; no session 401', async () => {
    const cashier = await member('cashier');
    const rider = await member('rider');
    const other = await ownerWithShop();
    for (const name of ['summary', 'products', 'staff', 'expenses']) {
      for (const user of [cashier, rider, other]) {
        expect((await get(`/reports/${name}${q(owner.shop_id)}`, user.token)).status, name).toBe(
          403,
        );
      }
      expect((await get(`/reports/${name}${q(owner.shop_id)}`)).status).toBe(401);
    }
    // The other owner still sees their own shop.
    expect((await get(`/reports/summary${q(other.shop_id)}`, other.token)).status).toBe(200);
  });

  it('range: at most 366 days, from <= to, valid ids', async () => {
    const at = (from: string, to: string) =>
      get(`/reports/summary?shop_id=${owner.shop_id}&from=${from}&to=${to}`, owner.token);
    expect((await at('2026-01-01', '2027-01-01')).status).toBe(200);
    expect((await at('2026-01-01', '2027-01-02')).status).toBe(400);
    expect((await at('2026-10-02', '2026-10-01')).status).toBe(400);
    expect(
      (await get(`/reports/summary?shop_id=nope&from=${FROM}&to=${TO}`, owner.token)).status,
    ).toBe(400);
  });
});
