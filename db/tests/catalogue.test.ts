// Catalogue (migration 20261121090000): RLS, device scopes for costs, write roles, append-only
// history.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  app,
  asUser,
  createFixture,
  errorCode,
  type Fixture,
  type Query,
} from './helpers.ts';

let f: Fixture;
let ownerDevice: string;
let categoryA: string;
let productA: string;
let productB: string;

beforeAll(async () => {
  f = await createFixture(); // f.deviceA = shop counter (mode 'shop')
  ownerDevice = randomUUID();
  categoryA = randomUUID();
  productA = randomUUID();
  productB = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q(
    `insert into devices (id, shop_id, name, code, registered_by, mode) values ($1, $2, 'Owner phone', 'A2', $3, 'owner')`,
    [ownerDevice, f.shopA, f.ownerA],
  );
  await q(
    `insert into categories (id, shop_id, name, name_ur) values ($1, $2, 'Vegetables', 'سبزیاں')`,
    [categoryA, f.shopA],
  );
  await q(
    `insert into products (id, shop_id, category_id, name, unit, sale_price_paisa, search_terms)
     values ($1, $2, $3, 'Potato', 'kg', 8000, '{aloo,aalu}')`,
    [productA, f.shopA, categoryA],
  );
  await q(`insert into products (id, shop_id, name, unit) values ($1, $2, 'Rice', 'kg')`, [
    productB,
    f.shopB,
  ]);
  await q(
    `insert into product_costs (product_id, shop_id, cost_price_paisa) values ($1, $2, 6000)`,
    [productA, f.shopA],
  );
  await q(
    `insert into price_history (id, shop_id, product_id, sale_price_paisa, effective_at) values ($1, $2, $3, 8000, now())`,
    [randomUUID(), f.shopA, productA],
  );
  await q(
    `insert into product_cost_history (id, shop_id, product_id, cost_price_paisa, effective_at) values ($1, $2, $3, 6000, now())`,
    [randomUUID(), f.shopA, productA],
  );
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const count = async (q: Query, table: string) => (await q(`select 1 from ${table}`)).rowCount;

describe('catalogue RLS', () => {
  it('members see their own shop only', async () => {
    await asUser(f.ownerA, async (q) => {
      const { rows } = await q<{ id: string }>('select id from products');
      expect(rows.map((r) => r.id)).toEqual([productA]);
      expect(await count(q, 'categories')).toBe(1);
    });
    await asUser(f.ownerB, async (q) => {
      const { rows } = await q<{ id: string }>('select id from products');
      expect(rows.map((r) => r.id)).toEqual([productB]);
      expect(await count(q, 'product_costs')).toBe(0);
    });
  });

  it('cashiers read products and sale prices, never costs or cost history', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(await count(q, 'products')).toBe(1);
      expect(await count(q, 'price_history')).toBe(1);
      expect(await count(q, 'product_costs')).toBe(0);
      expect(await count(q, 'product_cost_history')).toBe(0);
    });
    await asUser(f.ownerA, async (q) => {
      expect(await count(q, 'product_costs')).toBe(1);
      expect(await count(q, 'product_cost_history')).toBe(1);
    });
  });

  it('cashiers cannot change products, categories or prices', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(
        (await q(`update products set sale_price_paisa = 1 where id = $1`, [productA])).rowCount,
      ).toBe(0);
      expect(
        (await q(`update categories set name = 'X' where id = $1`, [categoryA])).rowCount,
      ).toBe(0);
      expect(
        await errorCode(
          q(
            `insert into price_history (id, shop_id, product_id, sale_price_paisa, effective_at) values ($1, $2, $3, 1, now())`,
            [randomUUID(), f.shopA, productA],
          ),
        ),
      ).toBe('42501');
    });
  });

  it('history is append-only: no updates, even for owners', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q(`update price_history set sale_price_paisa = 1`))).toBe('42501');
      expect(await errorCode(q(`update product_cost_history set cost_price_paisa = 1`))).toBe(
        '42501',
      );
      expect(await errorCode(q(`delete from products where id = $1`, [productA]))).toBe('42501');
    });
  });

  it('a product cannot use another shop’s category', async () => {
    const otherCategory = randomUUID();
    await admin.query(`insert into categories (id, shop_id, name) values ($1, $2, 'B cat')`, [
      otherCategory,
      f.shopB,
    ]);
    await asUser(f.ownerA, async (q) => {
      expect(
        await errorCode(
          q(
            `insert into products (id, shop_id, category_id, name, unit) values ($1, $2, $3, 'X', 'kg')`,
            [randomUUID(), f.shopA, otherCategory],
          ),
        ),
      ).toBe('23503');
    });
  });

  it('checks units, non-negative prices and search terms', async () => {
    await asUser(f.ownerA, async (q) => {
      const insert = (unit: string, price: number, terms: string[]) =>
        q(
          `insert into products (id, shop_id, name, unit, sale_price_paisa, search_terms) values ($1, $2, 'X', $3, $4, $5)`,
          [randomUUID(), f.shopA, unit, price, terms],
        );
      expect(await errorCode(insert('ton', 0, []))).toBe('23514');
      expect(await errorCode(insert('kg', -1, []))).toBe('23514');
      expect(await errorCode(insert('kg', 0, ['x'.repeat(41)]))).toBe('23514');
      expect(
        await errorCode(
          insert(
            'kg',
            0,
            Array.from({ length: 21 }, (_, i) => `t${i}`),
          ),
        ),
      ).toBe('23514');
      expect((await insert('kg', 0, ['aloo', 'aalu'])).rowCount).toBe(1);
    });
  });
});

interface PullResult {
  rows: { table: string; row: Record<string, unknown> }[];
  next_seq: number;
  has_more: boolean;
}
async function pulledTables(q: Query, device: string) {
  const tables = new Set<string>();
  let since = 0;
  for (;;) {
    const { rows } = await q<{ r: PullResult }>('select sync_pull($1, $2, 1000) as r', [
      device,
      since,
    ]);
    const page = rows[0]!.r;
    for (const r of page.rows) tables.add(r.table);
    since = page.next_seq;
    if (!page.has_more) return tables;
  }
}

describe('pulling the catalogue by device mode', () => {
  it('shop devices get products and sale history but never costs; owner devices get costs', async () => {
    await asUser(f.ownerA, async (q) => {
      const shop = await pulledTables(q, f.deviceA);
      for (const t of ['categories', 'products', 'price_history'])
        expect(shop.has(t), t).toBe(true);
      expect(shop.has('product_costs')).toBe(false);
      expect(shop.has('product_cost_history')).toBe(false);

      const owner = await pulledTables(q, ownerDevice);
      expect(owner.has('product_costs')).toBe(true);
      expect(owner.has('product_cost_history')).toBe(true);
    });
  });
});

interface PushResult {
  accepted: string[];
  errors: { id: string; code: string }[];
}
const push = async (q: Query, device: string, entries: unknown[]) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      device,
      JSON.stringify(entries),
    ])
  ).rows[0]!.r;

function costEntry(actor: string) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    table: 'product_costs',
    op: 'upsert',
    actor_staff_id: actor,
    row: {
      product_id: productA,
      shop_id: f.shopA,
      cost_price_paisa: 6500,
      created_at: now,
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

describe('pushing catalogue rows', () => {
  it('refuses product_costs from a shop device and from a cashier actor; accepts the owner on an owner device', async () => {
    await asUser(f.ownerA, async (q) => {
      const fromShop = costEntry(f.ownerStaffA);
      expect((await push(q, f.deviceA, [fromShop])).errors.map((e) => e.code)).toEqual([
        'forbidden',
      ]);
      const fromCashier = costEntry(f.cashierStaffA);
      expect((await push(q, ownerDevice, [fromCashier])).errors.map((e) => e.code)).toEqual([
        'forbidden',
      ]);
      const fromOwner = costEntry(f.ownerStaffA);
      expect((await push(q, ownerDevice, [fromOwner])).accepted).toEqual([fromOwner.id]);
    });
  });

  it('creates a product with search terms and its first price row; a retry adds nothing', async () => {
    await asUser(f.ownerA, async (q) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      const entries = [
        {
          id: randomUUID(),
          table: 'products',
          op: 'upsert',
          actor_staff_id: f.ownerStaffA,
          row: {
            id,
            shop_id: f.shopA,
            category_id: categoryA,
            name: 'Onion (red)',
            name_ur: 'پیاز',
            unit: 'kg',
            sale_price_paisa: 12000,
            search_terms: ['pyaz', 'piyaz'],
            created_at: now,
            updated_at: now,
          },
        },
        {
          id: randomUUID(),
          table: 'price_history',
          op: 'insert',
          actor_staff_id: f.ownerStaffA,
          row: {
            id: randomUUID(),
            shop_id: f.shopA,
            product_id: id,
            sale_price_paisa: 12000,
            effective_at: now,
            created_at: now,
          },
        },
      ];
      expect((await push(q, f.deviceA, entries)).accepted).toHaveLength(2);
      expect((await push(q, f.deviceA, entries)).accepted).toHaveLength(2);
      const { rows } = await q<{ search_terms: string[] }>(
        'select search_terms from products where id = $1',
        [id],
      );
      expect(rows[0]?.search_terms).toEqual(['pyaz', 'piyaz']);
      const history = await q('select 1 from price_history where product_id = $1', [id]);
      expect(history.rowCount).toBe(1);
    });
  });

  it('refuses product edits from a cashier actor', async () => {
    await asUser(f.ownerA, async (q) => {
      const now = new Date(Date.now() + 60_000).toISOString();
      const entry = {
        id: randomUUID(),
        table: 'products',
        op: 'upsert',
        actor_staff_id: f.cashierStaffA,
        row: {
          id: productA,
          shop_id: f.shopA,
          name: 'Potato',
          unit: 'kg',
          sale_price_paisa: 1,
          updated_at: now,
        },
      };
      expect((await push(q, f.deviceA, [entry])).errors.map((e) => e.code)).toEqual(['forbidden']);
    });
  });
});
