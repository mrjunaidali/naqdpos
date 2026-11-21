// Discounts and free items (migration 20261122120000): foc_rule check, sale/line checks, the
// approver rule and shops.cashier_max_discount_pct.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;
let productA: string;
let counter = 0;

beforeAll(async () => {
  f = await createFixture();
  productA = randomUUID();
  await admin.query('select seed_payment_methods($1)', [f.shopA]);
  await admin.query(
    `insert into products (id, shop_id, name, unit, sale_price_paisa) values ($1, $2, 'Coriander', 'bundle', 4000)`,
    [productA, f.shopA],
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
const entry = (table: string, row: Record<string, unknown>, actor: string, op = 'insert') => ({
  id: randomUUID(),
  table,
  op,
  actor_staff_id: actor,
  row,
});

/** Rs 214.50 tomatoes − Rs 10 line discount + a free coriander bundle; Rs 4.50 bill discount. */
function discountedSale(
  over: { approver?: string | null; billDiscount?: number; focTotal?: number } = {},
) {
  counter += 1;
  const saleId = randomUUID();
  const billDiscount = over.billDiscount ?? 450;
  const subtotal = 20450;
  return {
    saleId,
    sale: entry(
      'sales',
      {
        id: saleId,
        shop_id: f.shopA,
        receipt_no: `D1-${String(counter).padStart(6, '0')}`,
        business_date: '2026-11-22',
        staff_id: f.cashierStaffA,
        subtotal_paisa: subtotal,
        discount_paisa: billDiscount,
        rounding_paisa: 0,
        total_paisa: subtotal - billDiscount,
        discount_approved_by_staff_id: over.approver === undefined ? f.ownerStaffA : over.approver,
        created_at: now(),
      },
      f.cashierStaffA,
    ),
    lines: [
      entry(
        'sale_lines',
        {
          id: randomUUID(),
          shop_id: f.shopA,
          sale_id: saleId,
          product_id: null,
          name_snapshot: 'Tomato',
          unit_snapshot: 'kg',
          qty_milli: 1300,
          unit_price_paisa: 16500,
          discount_paisa: 1000,
          is_foc: false,
          by_amount: false,
          line_total_paisa: 20450,
          created_at: now(),
        },
        f.cashierStaffA,
      ),
      entry(
        'sale_lines',
        {
          id: randomUUID(),
          shop_id: f.shopA,
          sale_id: saleId,
          product_id: productA,
          name_snapshot: 'Coriander',
          unit_snapshot: 'bundle',
          qty_milli: 1000,
          unit_price_paisa: 4000,
          discount_paisa: 0,
          is_foc: true,
          by_amount: false,
          line_total_paisa: over.focTotal ?? 0,
          created_at: now(),
        },
        f.cashierStaffA,
      ),
    ],
  };
}

describe('discounts and FOC (US032, US033)', () => {
  it('accepts a discounted sale with a free line and an owner approver', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = discountedSale();
      expect((await push(q, [s.sale, ...s.lines])).errors).toEqual([]);
    });
  });

  it('a free line must total 0 with no discount', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = discountedSale({ focTotal: 4000 });
      expect(codes(await push(q, [s.sale, ...s.lines]))).toEqual(['invalid']);
    });
  });

  it('a bill discount cannot exceed the subtotal', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = discountedSale({ billDiscount: 20451 });
      (s.sale.row as { total_paisa: number }).total_paisa = 0;
      (s.sale.row as { rounding_paisa: number }).rounding_paisa = 0;
      expect(codes(await push(q, [s.sale]))).toEqual(['invalid']);
    });
  });

  it('the approver must be an owner of the shop', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(codes(await push(q, [discountedSale({ approver: f.cashierStaffA }).sale]))).toEqual([
        'invalid',
      ]);
      // Shop B's owner is not staff of shop A (the approver check runs before the FK).
      expect(codes(await push(q, [discountedSale({ approver: f.ownerStaffB }).sale]))).toEqual([
        'invalid',
      ]);
      expect((await push(q, [discountedSale({ approver: null }).sale])).errors).toEqual([]);
    });
  });

  it('foc_rule: null or exactly {min_bill_paisa, qty_milli}', async () => {
    /** null when the insert works, else the SQLSTATE. */
    const tryRule = (rule: unknown) =>
      asUser(f.ownerA, async (q) => {
        try {
          await q(
            `insert into products (id, shop_id, name, unit, sale_price_paisa, foc_rule)
             values ($1, $2, 'Mint', 'bundle', 3000, $3::jsonb)`,
            [randomUUID(), f.shopA, rule === null ? null : JSON.stringify(rule)],
          );
          return null;
        } catch (error) {
          return (error as { code?: string }).code ?? 'unknown';
        }
      });
    expect(await tryRule(null)).toBeNull();
    expect(await tryRule({ min_bill_paisa: 20000, qty_milli: 1000 })).toBeNull();
    expect(await tryRule({ min_bill_paisa: 0, qty_milli: 50 })).toBeNull();
    for (const bad of [
      { min_bill_paisa: 20000 },
      { min_bill_paisa: -1, qty_milli: 1000 },
      { min_bill_paisa: 20000, qty_milli: 0 },
      { min_bill_paisa: 20000, qty_milli: 1.5 },
      { min_bill_paisa: '200', qty_milli: 1000 },
      { min_bill_paisa: 20000, qty_milli: 10_000_000 },
      { min_bill_paisa: 20000, qty_milli: 1000, extra: true },
      [1, 2],
    ]) {
      expect(await tryRule(bad), JSON.stringify(bad)).toBe('23514');
    }
  });

  it('the cashier limit is 0–100 and owner-only', async () => {
    const limit = (pct: number, actor: string) =>
      entry(
        'shops',
        { id: f.shopA, cashier_max_discount_pct: pct, updated_at: now() },
        actor,
        'upsert',
      );
    await asUser(f.ownerA, async (q) => {
      expect(codes(await push(q, [limit(15, f.cashierStaffA)]))).toEqual(['forbidden']);
      expect(codes(await push(q, [limit(101, f.ownerStaffA)]))).toEqual(['invalid']);
      expect((await push(q, [limit(15, f.ownerStaffA)])).errors).toEqual([]);
      const { rows } = await q<{ p: number }>(
        'select cashier_max_discount_pct as p from shops where id = $1',
        [f.shopA],
      );
      expect(rows[0]!.p).toBe(15);
    });
    await asUser(f.cashierA, async (q) => {
      const r = await q('update shops set cashier_max_discount_pct = 50 where id = $1', [f.shopA]);
      expect(r.rowCount).toBe(0); // RLS: only owners update the shop
    });
    const { rows } = await admin.query<{ p: number }>(
      'select cashier_max_discount_pct as p from shops where id = $1',
      [f.shopB],
    );
    expect(rows[0]!.p).toBe(10); // default
  });

  it('pushes and pulls the discounted sale, the free line and the shop limit', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = discountedSale();
      await push(q, [s.sale, ...s.lines]);
      const { rows } = await q<{
        r: { rows: { table: string; row: Record<string, unknown> }[] };
      }>('select sync_pull($1, 0, 1000) as r', [f.deviceA]);
      const pulled = rows[0]!.r.rows;
      expect(pulled.find((r) => r.table === 'sales' && r.row.id === s.saleId)?.row).toMatchObject({
        discount_paisa: 450,
        discount_approved_by_staff_id: f.ownerStaffA,
      });
      expect(
        pulled.find((r) => r.table === 'sale_lines' && r.row.sale_id === s.saleId && r.row.is_foc)
          ?.row,
      ).toMatchObject({ line_total_paisa: 0, unit_price_paisa: 4000 });
      expect(
        pulled.find((r) => r.table === 'sale_lines' && r.row.sale_id === s.saleId && !r.row.is_foc)
          ?.row,
      ).toMatchObject({ discount_paisa: 1000, line_total_paisa: 20450 });
      expect(pulled.find((r) => r.table === 'shops')?.row).toHaveProperty(
        'cashier_max_discount_pct',
        10,
      );
    });
  });
});
