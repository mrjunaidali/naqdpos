// Sales, sale_lines, payments and payment_methods (migration 20261121210000).
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
let riderUser: string;
let riderStaff: string;
let productA: string;
let counter = 0;

beforeAll(async () => {
  f = await createFixture(); // fixture shops are inserted directly: seed their methods here
  riderUser = randomUUID();
  riderStaff = randomUUID();
  productA = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q('select seed_payment_methods($1), seed_payment_methods($2)', [f.shopA, f.shopB]);
  await q(`insert into users (id, name, email) values ($1, 'Rider', $2)`, [
    riderUser,
    `${riderUser}@example.test`,
  ]);
  await q(`insert into memberships (shop_id, user_id, role) values ($1, $2, 'rider')`, [
    f.shopA,
    riderUser,
  ]);
  await q(
    `insert into staff (id, shop_id, name, role, membership_user_id) values ($1, $2, 'Rider', 'rider', $3)`,
    [riderStaff, f.shopA, riderUser],
  );
  await q(
    `insert into products (id, shop_id, name, unit, sale_price_paisa) values ($1, $2, 'Tomato', 'kg', 16000)`,
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
const push = async (q: Query, device: string, entries: unknown[]) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      device,
      JSON.stringify(entries),
    ])
  ).rows[0]!.r;

const now = () => new Date().toISOString();
const entry = (table: string, row: Record<string, unknown>, actor: string = f.cashierStaffA) => ({
  id: randomUUID(),
  table,
  op: 'insert',
  actor_staff_id: actor,
  row,
});

/** A sale of 1.3 kg tomatoes at Rs 165 = Rs 214.50, rounded to Rs 215, paid in cash. */
function sale(
  overrides: {
    shop?: string;
    staff?: string;
    date?: string;
    method?: string;
    product?: string | null;
  } = {},
) {
  const shop = overrides.shop ?? f.shopA;
  const staff = overrides.staff ?? f.cashierStaffA;
  const saleId = randomUUID();
  const date = overrides.date ?? '2026-11-21';
  counter += 1;
  return {
    saleId,
    sale: entry(
      'sales',
      {
        id: saleId,
        shop_id: shop,
        receipt_no: `A1-${String(counter).padStart(6, '0')}`,
        business_date: date,
        staff_id: staff,
        order_type: 'walk_in',
        source: 'walk_in',
        subtotal_paisa: 21450,
        discount_paisa: 0,
        rounding_paisa: 50,
        total_paisa: 21500,
        created_at: now(),
      },
      staff,
    ),
    line: entry(
      'sale_lines',
      {
        id: randomUUID(),
        shop_id: shop,
        sale_id: saleId,
        product_id: overrides.product === undefined ? productA : overrides.product,
        name_snapshot: 'Tomato',
        name_ur_snapshot: 'ٹماٹر',
        unit_snapshot: 'kg',
        qty_milli: 1300,
        unit_price_paisa: 16500,
        discount_paisa: 0,
        is_foc: false,
        by_amount: false,
        line_total_paisa: 21450,
        created_at: now(),
      },
      staff,
    ),
    payment: entry(
      'payments',
      {
        id: randomUUID(),
        shop_id: shop,
        business_date: date,
        kind: 'sale',
        sale_id: saleId,
        method_code: overrides.method ?? 'cash',
        amount_paisa: 21500,
        staff_id: staff,
        created_at: now(),
      },
      staff,
    ),
  };
}

describe('pushing a sale', () => {
  it('a cashier pushes sale, line and payment; a retry adds nothing', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = sale();
      const batch = [s.sale, s.line, s.payment];
      expect((await push(q, f.deviceA, batch)).accepted).toHaveLength(3);
      expect((await push(q, f.deviceA, batch)).accepted).toHaveLength(3);
      expect((await q('select 1 from sales where id = $1', [s.saleId])).rowCount).toBe(1);
      expect((await q('select 1 from sale_lines where sale_id = $1', [s.saleId])).rowCount).toBe(1);
      expect((await q('select 1 from payments where sale_id = $1', [s.saleId])).rowCount).toBe(1);
      const { rows } = await q<{
        rounding_paisa: string;
        name_ur_snapshot: string;
        by_amount: boolean;
      }>(
        `select s.rounding_paisa, l.name_ur_snapshot, l.by_amount from sales s join sale_lines l on l.sale_id = s.id where s.id = $1`,
        [s.saleId],
      );
      expect(rows[0]).toEqual({
        rounding_paisa: '50',
        name_ur_snapshot: 'ٹماٹر',
        by_amount: false,
      });
    });
  });

  it('refuses a rider: by session (RLS) and as the acting staff member (write_roles)', async () => {
    await asUser(riderUser, async (q) => {
      // A rider has no rider device here; the shop counter's session check refuses first.
      const s = sale({ staff: riderStaff });
      const result = await push(q, f.deviceA, [s.sale]);
      expect(result.errors.map((e) => e.code)).toEqual(['forbidden']);
    });
    await asUser(f.ownerA, async (q) => {
      const s = sale({ staff: riderStaff });
      expect((await push(q, f.deviceA, [s.sale])).errors.map((e) => e.code)).toEqual(['forbidden']);
    });
  });

  it('refuses a closed business date (is_day_closed)', async () => {
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
      const closed = sale({ date: '2026-11-20' });
      const result = await push(q, f.deviceA, [closed.sale]);
      expect(result.errors.map((e) => e.code)).toEqual(['day_closed']);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('keeps receipt numbers unique per shop', async () => {
    await asUser(f.cashierA, async (q) => {
      const first = sale();
      await push(q, f.deviceA, [first.sale]);
      const dup = sale();
      (dup.sale.row as { receipt_no: string }).receipt_no = (
        first.sale.row as { receipt_no: string }
      ).receipt_no;
      expect((await push(q, f.deviceA, [dup.sale])).errors.map((e) => e.code)).toEqual(['invalid']);
    });
  });

  it('answers missing_parent for a line pushed before its sale, then accepts it', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = sale();
      const early = await push(q, f.deviceA, [s.line]);
      expect(early.errors.map((e) => e.code)).toEqual(['missing_parent']);
      expect((await push(q, f.deviceA, [s.sale])).accepted).toHaveLength(1);
      expect((await push(q, f.deviceA, [s.line])).accepted).toHaveLength(1);
    });
  });

  it('a sale of a product made offline in the same batch goes through', async () => {
    await asUser(f.ownerA, async (q) => {
      const productId = randomUUID();
      const product = entry(
        'products',
        {
          id: productId,
          shop_id: f.shopA,
          name: 'Karela',
          unit: 'kg',
          sale_price_paisa: 20000,
          created_at: now(),
          updated_at: now(),
        },
        f.ownerStaffA,
      );
      const s = sale({ staff: f.ownerStaffA, product: productId });
      const result = await push(q, f.deviceA, [product, s.sale, s.line, s.payment]);
      expect(result.errors).toEqual([]);
      expect(result.accepted).toHaveLength(4);
    });
  });

  it('a payment with an unknown method waits for its parent (missing_parent)', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = sale({ method: 'custom_deadbeef' });
      const result = await push(q, f.deviceA, [s.sale, s.payment]);
      expect(result.errors.map((e) => e.code)).toEqual(['missing_parent']);
    });
  });

  it('checks the total (subtotal − discount + rounding) and the rounding range', async () => {
    await asUser(f.cashierA, async (q) => {
      const bad = sale();
      (bad.sale.row as { total_paisa: number }).total_paisa = 21450;
      expect((await push(q, f.deviceA, [bad.sale])).errors.map((e) => e.code)).toEqual(['invalid']);
      const wide = sale();
      Object.assign(wide.sale.row, { rounding_paisa: 60, total_paisa: 21510 });
      expect((await push(q, f.deviceA, [wide.sale])).errors.map((e) => e.code)).toEqual([
        'invalid',
      ]);
    });
  });
});

describe('ledger rules', () => {
  it('append-only: no update or delete, even for owners', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = sale();
      await push(q, f.deviceA, [s.sale, s.line, s.payment]);
    });
    await asUser(f.ownerA, async (q) => {
      for (const table of ['sales', 'sale_lines', 'payments']) {
        expect(await errorCode(q(`update ${table} set created_at = now()`)), table).toBe('42501');
        expect(await errorCode(q(`delete from ${table}`)), table).toBe('42501');
      }
    });
  });

  it('shop isolation; riders see no sales', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = sale();
      await q('select 1');
      await push(q, f.deviceA, [s.sale]);
      expect((await q('select 1 from sales')).rowCount).toBeGreaterThan(0);
    });
    await asUser(f.ownerB, async (q) => expect((await q('select 1 from sales')).rowCount).toBe(0));
    await asUser(riderUser, async (q) => {
      for (const table of ['sales', 'sale_lines', 'payments']) {
        expect((await q(`select 1 from ${table}`)).rowCount, table).toBe(0);
      }
    });
  });

  it('a line cannot point at another shop’s sale', async () => {
    let otherSale = '';
    await asUser(f.ownerB, async (q) => {
      const s = sale({ shop: f.shopB, staff: f.ownerStaffB, product: null });
      otherSale = s.saleId;
      await q(
        `insert into sales (id, shop_id, receipt_no, business_date, staff_id, subtotal_paisa, total_paisa, created_at)
         values ($1, $2, 'A1-999999', '2026-11-21', $3, 100, 100, now())`,
        [s.saleId, f.shopB, f.ownerStaffB],
      );
    });
    await asUser(f.cashierA, async (q) => {
      const s = sale({ product: null });
      (s.line.row as { sale_id: string }).sale_id = otherSale;
      expect((await push(q, f.deviceA, [s.line])).errors.map((e) => e.code)).toEqual([
        'missing_parent',
      ]);
    });
  });

  it('pushes and pulls a sale round trip', async () => {
    await asUser(f.cashierA, async (q) => {
      const s = sale();
      await push(q, f.deviceA, [s.sale, s.line, s.payment]);
      const { rows } = await q<{
        r: { rows: { table: string; row: { id?: string; sale_id?: string } }[] };
      }>('select sync_pull($1, 0, 1000) as r', [f.deviceA]);
      const pulled = rows[0]!.r.rows;
      expect(pulled.some((r) => r.table === 'sales' && r.row.id === s.saleId)).toBe(true);
      expect(pulled.some((r) => r.table === 'sale_lines' && r.row.sale_id === s.saleId)).toBe(true);
      expect(pulled.some((r) => r.table === 'payments' && r.row.sale_id === s.saleId)).toBe(true);
      expect(pulled.some((r) => r.table === 'payment_methods')).toBe(true);
    });
  });
});

describe('payment_methods', () => {
  it('are seeded for every shop: cash, JazzCash, Easypaisa, bank', async () => {
    await asUser(f.cashierA, async (q) => {
      const { rows } = await q<{ code: string }>('select code from payment_methods order by sort');
      expect(rows.map((r) => r.code)).toEqual(['cash', 'jazzcash', 'easypaisa', 'bank']);
    });
  });

  it('only owners change them; cash cannot be switched off', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(
        (await q(`update payment_methods set active = false where code = 'bank'`)).rowCount,
      ).toBe(0);
      expect(
        await errorCode(
          q(
            `insert into payment_methods (id, shop_id, code, label) values ($1, $2, 'custom_aa', 'X')`,
            [randomUUID(), f.shopA],
          ),
        ),
      ).toBe('42501');
    });
    await asUser(f.ownerA, async (q) => {
      expect(
        (await q(`update payment_methods set active = false where code = 'bank'`)).rowCount,
      ).toBe(1);
      expect(
        await errorCode(q(`update payment_methods set active = false where code = 'cash'`)),
      ).toBe('23514');
      const added = await q(
        `insert into payment_methods (id, shop_id, code, label, sort) values ($1, $2, 'custom_ab12cd34', 'Sadapay', 5)`,
        [randomUUID(), f.shopA],
      );
      expect(added.rowCount).toBe(1);
    });
  });

  it('are pushed only by an owner acting', async () => {
    await asUser(f.ownerA, async (q) => {
      const row = {
        id: randomUUID(),
        shop_id: f.shopA,
        code: 'custom_00ff00ff',
        label: 'NayaPay',
        active: true,
        sort: 6,
        created_at: now(),
        updated_at: now(),
      };
      const asCashier = { ...entry('payment_methods', row, f.cashierStaffA), op: 'upsert' };
      expect((await push(q, f.deviceA, [asCashier])).errors.map((e) => e.code)).toEqual([
        'forbidden',
      ]);
      const asOwner = { ...entry('payment_methods', row, f.ownerStaffA), op: 'upsert' };
      expect((await push(q, f.deviceA, [asOwner])).accepted).toHaveLength(1);
    });
  });
});
