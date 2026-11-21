// Customers, khata_entries, customer_balances (migration 20261122150000).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerId } from '../../packages/core/src/uuid5.ts';
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;
let deviceB: string;
let riderUser: string;
let counter = 0;

beforeAll(async () => {
  f = await createFixture();
  deviceB = randomUUID();
  riderUser = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q('select seed_payment_methods($1)', [f.shopA]);
  await q(
    `insert into devices (id, shop_id, name, code, registered_by) values ($1, $2, 'Counter 2', 'B1', $3)`,
    [deviceB, f.shopA, f.ownerA],
  );
  await q(`insert into users (id, name, email) values ($1, 'Rider', $2)`, [
    riderUser,
    `${riderUser}@example.test`,
  ]);
  await q(`insert into memberships (shop_id, user_id, role) values ($1, $2, 'rider')`, [
    f.shopA,
    riderUser,
  ]);
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

interface PushResult {
  accepted: string[];
  conflicts: unknown[];
  errors: { id: string; code: string; message?: string }[];
}
const push = async (q: Query, entries: unknown[], device = f.deviceA) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      device,
      JSON.stringify(entries),
    ])
  ).rows[0]!.r;
const codes = (r: PushResult) => r.errors.map((e) => e.code);
const at = (minutesAgo = 0) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const entry = (
  table: string,
  row: Record<string, unknown>,
  actor = f.cashierStaffA,
  op = 'insert',
) => ({
  id: randomUUID(),
  table,
  op,
  actor_staff_id: actor,
  row,
});

let mobileN = 1_000_000;
async function customer(over: Record<string, unknown> = {}) {
  mobileN += 1;
  const mobile = `+92300${mobileN}`;
  const id = (await customerId(f.shopA, mobile))!;
  const row = {
    id,
    shop_id: f.shopA,
    mobile,
    name: 'Ali',
    address: null,
    credit_limit_paisa: null,
    whatsapp_opt_in: false,
    created_at: at(5),
    updated_at: at(5),
    deleted_at: null,
    device_id: f.deviceA,
    ...over,
  };
  return { id, mobile, row, push: entry('customers', row, f.cashierStaffA, 'upsert') };
}

function sale(customer: string | null, staff = f.cashierStaffA) {
  counter += 1;
  const id = randomUUID();
  return {
    id,
    entry: entry(
      'sales',
      {
        id,
        shop_id: f.shopA,
        receipt_no: `K1-${String(counter).padStart(6, '0')}`,
        business_date: '2026-11-22',
        staff_id: staff,
        customer_id: customer,
        subtotal_paisa: 21500,
        discount_paisa: 0,
        rounding_paisa: 0,
        total_paisa: 21500,
        created_at: at(),
      },
      staff,
    ),
  };
}

function khata(
  customer: string,
  over: Record<string, unknown> & { type: string; amount_paisa: number },
  actor = f.cashierStaffA,
) {
  return entry(
    'khata_entries',
    {
      id: randomUUID(),
      shop_id: f.shopA,
      customer_id: customer,
      business_date: '2026-11-22',
      sale_id: null,
      payment_id: null,
      note: null,
      staff_id: actor,
      created_at: at(),
      device_id: f.deviceA,
      ...over,
    },
    actor,
  );
}

function payment(customer: string | null, amount: number, over: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    entry: entry('payments', {
      id,
      shop_id: f.shopA,
      business_date: '2026-11-22',
      kind: 'khata_receipt',
      sale_id: null,
      customer_id: customer,
      method_code: 'cash',
      amount_paisa: amount,
      reference: null,
      staff_id: f.cashierStaffA,
      created_at: at(),
      device_id: f.deviceA,
      ...over,
    }),
  };
}

describe('customers (US038)', () => {
  it('the same mobile added on two devices merges: no rejection, the newer name wins', async () => {
    await asUser(f.ownerA, async (q) => {
      const c = await customer({ name: 'Ali', updated_at: at(5) });
      expect((await push(q, [c.push])).accepted).toHaveLength(1);
      // Device B made the same customer offline (same UUIDv5 id), with a later edit.
      const fromB = entry(
        'customers',
        { ...c.row, name: 'Ali Raza', device_id: deviceB, updated_at: at(1) },
        f.cashierStaffA,
        'upsert',
      );
      const result = await push(q, [fromB], deviceB);
      expect(result.errors).toEqual([]);
      expect(result.accepted).toHaveLength(1);
      const { rows } = await q<{ name: string; n: string }>(
        'select name, (select count(*) from customers where mobile = $2)::text as n from customers where id = $1',
        [c.id, c.mobile],
      );
      expect(rows[0]).toEqual({ name: 'Ali Raza', n: '1' });
    });
  });

  it('the mobile cannot change', async () => {
    await asUser(f.cashierA, async (q) => {
      const c = await customer();
      await push(q, [c.push]);
      const moved = entry(
        'customers',
        { ...c.row, mobile: '+923009999999', updated_at: at() },
        f.cashierStaffA,
        'upsert',
      );
      expect(codes(await push(q, [moved]))).toEqual(['invalid']);
    });
  });
});

describe('khata (US039–US041)', () => {
  it('a sale partly on khata: sale, cash payment and credit_sale entry', async () => {
    await asUser(f.cashierA, async (q) => {
      const c = await customer();
      const s = sale(c.id);
      const cash = payment(c.id, 10000, { kind: 'sale', sale_id: s.id });
      const credit = khata(c.id, { type: 'credit_sale', amount_paisa: 11500, sale_id: s.id });
      expect((await push(q, [c.push, s.entry, cash.entry, credit])).errors).toEqual([]);
      const { rows } = await q<{ balance_paisa: string }>(
        'select balance_paisa from customer_balances where customer_id = $1',
        [c.id],
      );
      expect(Number(rows[0]!.balance_paisa)).toBe(11500);
    });
  });

  it('credit_sale: missing_parent before its sale, refused without a sale', async () => {
    await asUser(f.cashierA, async (q) => {
      const c = await customer();
      await push(q, [c.push]);
      const s = sale(c.id);
      const credit = khata(c.id, { type: 'credit_sale', amount_paisa: 21500, sale_id: s.id });
      expect(codes(await push(q, [credit]))).toEqual(['missing_parent']);
      expect((await push(q, [s.entry, credit])).errors).toEqual([]);
      expect(
        codes(await push(q, [khata(c.id, { type: 'credit_sale', amount_paisa: 100 })])),
      ).toEqual(['invalid']);
      // A sale for a customer the server has not seen waits too.
      const unknown = await customer();
      expect(codes(await push(q, [sale(unknown.id).entry]))).toEqual(['missing_parent']);
    });
  });

  it('a received payment: khata_receipt with a customer and the negative entry', async () => {
    await asUser(f.cashierA, async (q) => {
      const c = await customer();
      const p = payment(c.id, 50000);
      const back = khata(c.id, { type: 'payment', amount_paisa: -50000, payment_id: p.id });
      expect((await push(q, [c.push, p.entry, back])).errors).toEqual([]);
      expect(codes(await push(q, [payment(null, 100).entry]))).toEqual(['invalid']);
      expect(codes(await push(q, [khata(c.id, { type: 'payment', amount_paisa: -1 })]))).toEqual([
        'invalid',
      ]);
    });
  });

  it('adjustment: owner actor only, note required', async () => {
    await asUser(f.ownerA, async (q) => {
      const c = await customer();
      await push(q, [c.push]);
      const byCashier = khata(c.id, { type: 'adjustment', amount_paisa: -2000, note: 'fix' });
      expect(codes(await push(q, [byCashier]))).toEqual(['forbidden']);
      const noNote = khata(c.id, { type: 'adjustment', amount_paisa: -2000 }, f.ownerStaffA);
      expect(codes(await push(q, [noNote]))).toEqual(['invalid']);
      const ok = khata(
        c.id,
        { type: 'adjustment', amount_paisa: -2000, note: 'fix' },
        f.ownerStaffA,
      );
      expect((await push(q, [ok])).errors).toEqual([]);
    });
    await asUser(f.cashierA, async (q) => {
      const c = await customer();
      await push(q, [c.push]);
      const direct = q(
        `insert into khata_entries (id, shop_id, customer_id, business_date, type, amount_paisa, note, staff_id, created_at)
         values ($1, $2, $3, '2026-11-22', 'adjustment', 100, 'x', $4, now())`,
        [randomUUID(), f.shopA, c.id, f.cashierStaffA],
      );
      await expect(direct).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('refuses a closed business date', async () => {
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
      const c = await customer();
      await push(q, [c.push]);
      const old = khata(c.id, {
        type: 'adjustment',
        amount_paisa: 100,
        note: 'x',
        business_date: '2026-11-20',
      });
      expect(codes(await push(q, [old]))).toEqual(['day_closed']);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('append-only; shop isolation; riders see nothing', async () => {
    await asUser(f.cashierA, async (q) => {
      const as = (user: string) => q(`select set_config('app.user_id', $1, true)`, [user]);
      const c = await customer();
      const p = payment(c.id, 500);
      await push(q, [
        c.push,
        p.entry,
        khata(c.id, { type: 'payment', amount_paisa: -500, payment_id: p.id }),
      ]);
      await expect(q('update khata_entries set note = $1', ['x'])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(q('delete from khata_entries')).rejects.toMatchObject({ code: '42501' });
      for (const user of [f.ownerB, riderUser]) {
        await as(user);
        for (const table of ['customers', 'khata_entries', 'customer_balances']) {
          expect((await q(`select 1 from ${table}`)).rowCount, `${user} ${table}`).toBe(0);
        }
      }
    });
    await asUser(riderUser, async (q) => {
      const c = await customer();
      expect(codes(await push(q, [c.push]))).toEqual(['forbidden']);
    });
  });

  it('pushes and pulls customers and khata round trip', async () => {
    await asUser(f.cashierA, async (q) => {
      const c = await customer({ name: 'Bilal' });
      const s = sale(c.id);
      const credit = khata(c.id, { type: 'credit_sale', amount_paisa: 21500, sale_id: s.id });
      await push(q, [c.push, s.entry, credit]);
      const { rows } = await q<{
        r: { rows: { table: string; row: Record<string, unknown> }[] };
      }>('select sync_pull($1, 0, 1000) as r', [f.deviceA]);
      const pulled = rows[0]!.r.rows;
      expect(pulled.find((r) => r.table === 'customers' && r.row.id === c.id)?.row).toMatchObject({
        mobile: c.mobile,
        name: 'Bilal',
      });
      expect(
        pulled.find((r) => r.table === 'khata_entries' && r.row.sale_id === s.id)?.row,
      ).toMatchObject({ type: 'credit_sale', amount_paisa: 21500, customer_id: c.id });
      expect(pulled.find((r) => r.table === 'sales' && r.row.id === s.id)?.row.customer_id).toBe(
        c.id,
      );
    });
  });
});
