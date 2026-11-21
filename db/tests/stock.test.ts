// stock_movements, stock_movements_check() and the product_stock view (migration 20261122090000).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../packages/core/src/fixtures/stock-movements.json' with { type: 'json' };
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
let riderUser: string;
let productA: string;
let productB: string;
let counter = 0;

beforeAll(async () => {
  f = await createFixture();
  riderUser = randomUUID();
  productA = randomUUID();
  productB = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q('select seed_payment_methods($1)', [f.shopA]);
  await q(`insert into users (id, name, email) values ($1, 'Rider', $2)`, [
    riderUser,
    `${riderUser}@example.test`,
  ]);
  await q(`insert into memberships (shop_id, user_id, role) values ($1, $2, 'rider')`, [
    f.shopA,
    riderUser,
  ]);
  await q(
    `insert into products (id, shop_id, name, unit, sale_price_paisa, track_stock)
     values ($1, $2, 'Tomato', 'kg', 16000, true), ($3, $4, 'Onion', 'kg', 12000, true)`,
    [productA, f.shopA, productB, f.shopB],
  );
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

interface PushResult {
  accepted: string[];
  errors: { id: string; code: string; message?: string }[];
}
const push = async (q: Query, entries: unknown[]) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      f.deviceA,
      JSON.stringify(entries),
    ])
  ).rows[0]!.r;
const codes = (r: PushResult) => r.errors.map((e) => e.code);

const now = () => new Date().toISOString();
const entry = (table: string, row: Record<string, unknown>, actor: string) => ({
  id: randomUUID(),
  table,
  op: 'insert',
  actor_staff_id: actor,
  row,
});

function movement(
  over: Partial<{
    reason: string;
    qty: number;
    ref: string | null;
    actor: string;
    date: string;
    product: string;
    note: string | null;
  }> = {},
) {
  const actor = over.actor ?? f.cashierStaffA;
  return entry(
    'stock_movements',
    {
      id: randomUUID(),
      shop_id: f.shopA,
      product_id: over.product ?? productA,
      business_date: over.date ?? '2026-11-22',
      qty_milli: over.qty ?? -500,
      reason: over.reason ?? 'wastage',
      ref_id: over.ref ?? null,
      note: over.note ?? null,
      staff_id: actor,
      created_at: now(),
      device_id: f.deviceA,
    },
    actor,
  );
}

function saleEntry(staff = f.cashierStaffA) {
  counter += 1;
  const id = randomUUID();
  return {
    id,
    entry: entry(
      'sales',
      {
        id,
        shop_id: f.shopA,
        receipt_no: `S1-${String(counter).padStart(6, '0')}`,
        business_date: '2026-11-22',
        staff_id: staff,
        subtotal_paisa: 16000,
        discount_paisa: 0,
        rounding_paisa: 0,
        total_paisa: 16000,
        created_at: now(),
      },
      staff,
    ),
  };
}

describe('stock_movements (US024, US025)', () => {
  it('a cashier records wastage and damaged stock', async () => {
    await asUser(f.cashierA, async (q) => {
      const result = await push(q, [movement(), movement({ reason: 'damaged', qty: -1000 })]);
      expect(result.accepted).toHaveLength(2);
    });
  });

  it('stock in and set stock: refused for a cashier actor, accepted for the owner', async () => {
    // A shared shop device: the session is the owner's, the actor is who is switched in.
    await asUser(f.ownerA, async (q) => {
      const byCashier = await push(q, [
        movement({ reason: 'purchase', qty: 20000 }),
        movement({ reason: 'count_correction', qty: 125, note: 'counted 12.5 kg' }),
      ]);
      expect(codes(byCashier)).toEqual(['forbidden', 'forbidden']);

      const byOwner = await push(q, [
        movement({ reason: 'purchase', qty: 20000, actor: f.ownerStaffA }),
        movement({
          reason: 'count_correction',
          qty: 125,
          actor: f.ownerStaffA,
          note: 'counted 12.5 kg',
        }),
      ]);
      expect(byOwner.accepted).toHaveLength(2);
      const { rows } = await q<{ note: string }>(
        `select note from stock_movements where reason = 'count_correction' and note is not null`,
      );
      expect(rows.map((r) => r.note)).toContain('counted 12.5 kg');
    });
  });

  it('a direct insert by a cashier session cannot add stock in', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(
        await errorCode(
          q(
            `insert into stock_movements (id, shop_id, product_id, business_date, qty_milli, reason, staff_id, created_at)
             values ($1, $2, $3, '2026-11-22', 1000, 'purchase', $4, now())`,
            [randomUUID(), f.shopA, productA, f.cashierStaffA],
          ),
        ),
      ).toBe('42501');
    });
  });

  it("'sale' needs a sale: missing_parent until the sale arrives, then accepted", async () => {
    await asUser(f.cashierA, async (q) => {
      const s = saleEntry();
      const m = movement({ reason: 'sale', qty: -1000, ref: s.id });
      expect(codes(await push(q, [m]))).toEqual(['missing_parent']);
      expect((await push(q, [s.entry, m])).accepted).toHaveLength(2);
      // No ref at all is a bad row, not a missing parent.
      expect(codes(await push(q, [movement({ reason: 'sale', qty: -1 })]))).toEqual(['invalid']);
    });
  });

  it('refuses zero quantities, unknown reasons and riders', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(codes(await push(q, [movement({ qty: 0 }), movement({ reason: 'stolen' })]))).toEqual([
        'invalid',
        'invalid',
      ]);
    });
    await asUser(riderUser, async (q) => {
      expect(codes(await push(q, [movement()]))).toEqual(['forbidden']);
    });
  });

  it('accepts a late row for a closed business date (flagged at closing, not rejected)', async () => {
    const client = await admin.connect();
    try {
      await client.query('begin');
      await client.query(
        `create or replace function public.is_day_closed(p_shop_id uuid, p_business_date date)
         returns boolean language sql stable as $fn$ select p_business_date = date '2026-11-20' $fn$`,
      );
      await client.query('set local role naqdpos_app');
      await client.query(`select set_config('app.user_id', $1, true)`, [f.cashierA]);
      const q: Query = (text, values) => client.query(text, values);
      expect((await push(q, [movement({ date: '2026-11-20' })])).errors).toEqual([]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('append-only, shop isolation, riders see nothing', async () => {
    // One transaction (asUser rolls back at the end): shop A's rows exist while B and the rider look.
    await asUser(f.ownerA, async (q) => {
      const as = (user: string) => q(`select set_config('app.user_id', $1, true)`, [user]);
      expect((await push(q, [movement({ actor: f.ownerStaffA })])).accepted).toHaveLength(1);
      expect(await errorCode(q('update stock_movements set note = null'))).toBe('42501');
      expect(await errorCode(q('delete from stock_movements'))).toBe('42501');
      expect((await q('select 1 from stock_movements')).rowCount).toBeGreaterThan(0);
      expect((await q('select 1 from product_stock')).rowCount).toBeGreaterThan(0);

      await as(f.ownerB);
      expect((await q('select 1 from stock_movements')).rowCount).toBe(0);
      expect((await q('select 1 from product_stock')).rowCount).toBe(0);
      await as(riderUser);
      expect((await q('select 1 from stock_movements')).rowCount).toBe(0);
      expect((await q('select 1 from product_stock')).rowCount).toBe(0);
    });
    // A movement for another shop's product
    await asUser(f.cashierA, async (q) => {
      expect(codes(await push(q, [movement({ product: productB })]))).toEqual(['missing_parent']);
    });
  });

  it('has no cost column', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'stock_movements'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.column_name.includes('cost'))).toEqual([]);
  });

  it('product_stock gives the same totals as stockByProduct (shared fixture)', async () => {
    const ids = Object.fromEntries(
      Object.keys(fixture.products).map((name) => [name, randomUUID()]),
    ) as Record<string, string>;
    await asUser(f.ownerA, async (q) => {
      for (const [name, id] of Object.entries(ids)) {
        await q(
          `insert into products (id, shop_id, name, unit, sale_price_paisa, track_stock)
           values ($1, $2, $3, 'kg', 100, true)`,
          [id, f.shopA, `Fixture ${name} ${id.slice(0, 4)}`],
        );
      }
      const s = saleEntry(f.ownerStaffA);
      await push(q, [s.entry]);
      const entries = fixture.movements.map((m) =>
        movement({
          product: ids[m.product]!,
          qty: m.qty_milli,
          reason: m.reason,
          ref: m.reason === 'sale' ? s.id : null,
          actor: f.ownerStaffA,
        }),
      );
      expect((await push(q, entries)).errors).toEqual([]);
      const { rows } = await q<{ product_id: string; qty_milli: string }>(
        'select product_id, qty_milli from product_stock where product_id = any($1)',
        [Object.values(ids)],
      );
      const byId = new Map(rows.map((r) => [r.product_id, Number(r.qty_milli)]));
      for (const [name, expected] of Object.entries(fixture.expected)) {
        expect(byId.get(ids[name]!), name).toBe(expected);
      }
    });
  });

  it('pushes and pulls a movement round trip', async () => {
    await asUser(f.cashierA, async (q) => {
      const m = movement({ note: 'rotten' });
      expect((await push(q, [m])).accepted).toHaveLength(1);
      const { rows } = await q<{
        r: { rows: { table: string; row: { id?: string; note?: string } }[] };
      }>('select sync_pull($1, 0, 1000) as r', [f.deviceA]);
      const pulled = rows[0]!.r.rows.find(
        (r) => r.table === 'stock_movements' && r.row.id === m.row.id,
      );
      expect(pulled?.row.note).toBe('rotten');
    });
  });

  it('clears the acting staff member after sync_push', async () => {
    await asUser(f.ownerA, async (q) => {
      await push(q, [movement({ actor: f.ownerStaffA })]);
      const { rows } = await q<{ v: string }>(
        `select coalesce(current_setting('app.actor_staff_id', true), '') as v`,
      );
      expect(rows[0]!.v).toBe('');
    });
  });
});
