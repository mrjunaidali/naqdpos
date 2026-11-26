// The ml unit through sync, sync_units(), and the per-entry `field` on rejections
// (migration 20261126090000_sync_units_field; bug 2026-11-25 "Staging rejects a product change").
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
  await admin.query('select seed_payment_methods($1)', [f.shopA]);
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

interface PushResult {
  accepted: string[];
  errors: { id: string; code: string; message?: string; field?: string }[];
}
interface PullResult {
  rows: { table: string; row: Record<string, unknown>; server_seq: number }[];
  next_seq: number;
  has_more: boolean;
}

const push = async (q: Query, entries: unknown[]) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      f.deviceA,
      JSON.stringify(entries),
    ])
  ).rows[0]!.r;

async function pullAll(q: Query): Promise<PullResult['rows']> {
  const rows: PullResult['rows'] = [];
  let since = 0;
  for (;;) {
    const { rows: page } = await q<{ r: PullResult }>('select sync_pull($1, $2, 1000) as r', [
      f.deviceA,
      since,
    ]);
    rows.push(...page[0]!.r.rows);
    if (!page[0]!.r.has_more) return rows;
    since = page[0]!.r.next_seq;
  }
}

const now = () => new Date().toISOString();
const entry = (table: string, row: Record<string, unknown>, actor: string) => ({
  id: randomUUID(),
  table,
  op: table === 'products' ? 'upsert' : 'insert',
  actor_staff_id: actor,
  row,
});

const product = (overrides: Record<string, unknown> = {}) =>
  entry(
    'products',
    {
      id: randomUUID(),
      shop_id: f.shopA,
      name: 'Rose water',
      unit: 'ml',
      sale_price_paisa: 5000,
      created_at: now(),
      updated_at: now(),
      ...overrides,
    },
    f.ownerStaffA,
  );

/** The units a check constraint allows, read from its definition. */
async function checkUnits(table: string, constraint: string): Promise<string[]> {
  const { rows } = await admin.query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = $1::regclass and conname = $2`,
    [`public.${table}`, constraint],
  );
  return [...rows[0]!.def.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
}

describe('sync_units()', () => {
  it('lists ml and matches both unit checks (update it with any unit migration)', async () => {
    const { rows } = await admin.query<{ u: string[] }>('select sync_units() as u');
    const units = [...rows[0]!.u].sort();
    expect(units).toContain('ml');
    expect(await checkUnits('products', 'products_unit_check')).toEqual(units);
    expect(await checkUnits('sale_lines', 'sale_lines_unit_snapshot_check')).toEqual(units);
  });

  it('the API role may call it', async () => {
    await asUser(f.cashierA, async (q) => {
      const { rows } = await q<{ u: string[] }>('select sync_units() as u');
      expect(rows[0]!.u).toContain('ml');
    });
  });
});

describe('an ml product and an ml sale line through sync_push and sync_pull', () => {
  it('are accepted and come back with unit ml', async () => {
    const p = product();
    const saleId = randomUUID();
    const lineId = randomUUID();
    const common = { shop_id: f.shopA, created_at: now() };
    const cashier = f.cashierStaffA;
    const batch = [
      entry(
        'sales',
        {
          ...common,
          id: saleId,
          receipt_no: 'A1-900001',
          business_date: '2026-11-25',
          staff_id: cashier,
          order_type: 'walk_in',
          source: 'walk_in',
          subtotal_paisa: 30000,
          discount_paisa: 0,
          rounding_paisa: 0,
          total_paisa: 30000,
        },
        cashier,
      ),
      // 6 ml at Rs 50 per ml = Rs 300.
      entry(
        'sale_lines',
        {
          ...common,
          id: lineId,
          sale_id: saleId,
          product_id: p.row.id,
          name_snapshot: 'Rose water',
          name_ur_snapshot: null,
          unit_snapshot: 'ml',
          qty_milli: 6000,
          unit_price_paisa: 5000,
          discount_paisa: 0,
          is_foc: false,
          by_amount: false,
          line_total_paisa: 30000,
        },
        cashier,
      ),
      entry(
        'payments',
        {
          ...common,
          id: randomUUID(),
          business_date: '2026-11-25',
          kind: 'sale',
          sale_id: saleId,
          method_code: 'cash',
          amount_paisa: 30000,
          staff_id: cashier,
        },
        cashier,
      ),
    ];
    // One transaction (asUser rolls back at the end): the owner's phone pushes the product,
    // then the cashier's sale on the same device, then pulls.
    await asUser(f.ownerA, async (q) => {
      expect(await push(q, [p])).toEqual(expect.objectContaining({ accepted: [p.id], errors: [] }));
      const result = await push(q, batch);
      expect(result.errors).toEqual([]);
      expect(result.accepted).toHaveLength(3);

      const pulled = await pullAll(q);
      const pulledProduct = pulled.find((r) => r.table === 'products' && r.row.id === p.row.id);
      expect(pulledProduct?.row).toEqual(
        expect.objectContaining({ unit: 'ml', name: 'Rose water' }),
      );
      const pulledLine = pulled.find((r) => r.table === 'sale_lines' && r.row.id === lineId);
      expect(pulledLine?.row).toEqual(
        expect.objectContaining({ unit_snapshot: 'ml', qty_milli: 6000, line_total_paisa: 30000 }),
      );
    });
  });
});

describe('sync_push names the failed field', () => {
  it('a unit the database does not know: field unit, message keeps the reason', async () => {
    const bad = product({ unit: 'ton' });
    await asUser(f.ownerA, async (q) => {
      const { errors } = await push(q, [bad]);
      expect(errors).toEqual([
        {
          id: bad.id,
          code: 'invalid',
          field: 'unit',
          message: expect.stringContaining('products_unit_check') as string,
        },
      ]);
    });
  });

  it('a missing required column: field is that column', async () => {
    const bad = product();
    delete bad.row.name;
    await asUser(f.ownerA, async (q) => {
      const { errors } = await push(q, [bad]);
      expect(errors).toEqual([expect.objectContaining({ code: 'invalid', field: 'name' })]);
    });
  });

  it('a row without its id: field is the id column', async () => {
    const bad = product();
    delete bad.row.id;
    await asUser(f.ownerA, async (q) => {
      const { errors } = await push(q, [bad]);
      expect(errors).toEqual([expect.objectContaining({ code: 'invalid', field: 'id' })]);
    });
  });

  it('other rejections carry no field (the error shape is unchanged)', async () => {
    const other = product({ shop_id: f.shopB });
    await asUser(f.ownerA, async (q) => {
      const { errors } = await push(q, [other]);
      expect(errors).toEqual([{ id: other.id, code: 'other_shop' }]);
    });
  });
});

describe('the migration re-checks the ml unit idempotently', () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../migrations/20261126090000_sync_units_field.sql'),
    'utf8',
  );
  const block = /^do \$\$[\s\S]*?^\$\$;/m.exec(sql)?.[0];

  const constraintOids = async () =>
    (
      await admin.query<{ oid: number }>(
        `select oid from pg_constraint
         where conname in ('products_unit_check', 'sale_lines_unit_snapshot_check') order by conname`,
      )
    ).rows.map((r) => r.oid);

  it('leaves checks that already allow ml alone, however often it runs', async () => {
    expect(block).toBeDefined();
    const before = await constraintOids();
    await admin.query(block!);
    await admin.query(block!);
    expect(await constraintOids()).toEqual(before);
  });
});
