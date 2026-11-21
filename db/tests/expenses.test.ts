// expense_categories, expenses, expenses_check() (migration 20261122210000).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;
let riderUser: string;
let rent: string;

beforeAll(async () => {
  f = await createFixture();
  riderUser = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q(`update shops set type = 'fruit_veg' where id = $1`, [f.shopA]);
  await q(`update shops set type = 'grocery' where id = $1`, [f.shopB]);
  // Fixture shops are inserted directly, so seed them here (create_shop does it for real shops).
  await q('select seed_payment_methods($1), seed_expense_categories($1)', [f.shopA]);
  await q('select seed_expense_categories($1)', [f.shopB]);
  await q(`insert into users (id, name, email) values ($1, 'Rider', $2)`, [
    riderUser,
    `${riderUser}@example.test`,
  ]);
  await q(`insert into memberships (shop_id, user_id, role) values ($1, $2, 'rider')`, [
    f.shopA,
    riderUser,
  ]);
  rent = (
    await admin.query<{ id: string }>(
      `select id from expense_categories where shop_id = $1 and i18n_key = 'expense.cat.rent'`,
      [f.shopA],
    )
  ).rows[0]!.id;
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

function expense(over: Record<string, unknown> = {}, actor = f.cashierStaffA) {
  const id = randomUUID();
  return {
    id,
    entry: {
      id: randomUUID(),
      table: 'expenses',
      op: 'insert',
      actor_staff_id: actor,
      row: {
        id,
        shop_id: f.shopA,
        business_date: '2026-11-22',
        category_id: rent,
        amount_paisa: 50_000,
        paid_method_code: 'cash',
        note: null,
        payee: null,
        staff_id: actor,
        approved_by_staff_id: null,
        reverses_expense_id: null,
        reversal_reason: null,
        created_at: new Date().toISOString(),
        device_id: f.deviceA,
        ...over,
      },
    },
  };
}
const reversal = (of: string, amount = -50_000, actor = f.ownerStaffA) =>
  expense({ reverses_expense_id: of, amount_paisa: amount, reversal_reason: 'wrong' }, actor);

describe('expense categories (US065)', () => {
  it('seeds defaults per shop type, never Wastage', async () => {
    const keys = async (shop: string) =>
      (
        await admin.query<{ k: string }>(
          'select i18n_key as k from expense_categories where shop_id = $1 order by sort',
          [shop],
        )
      ).rows.map((r) => r.k.replace('expense.cat.', ''));
    expect(await keys(f.shopA)).toEqual([
      'mandi_transport',
      'rent',
      'bijli_gas',
      'staff_salary',
      'staff_advance',
      'petrol',
      'shopping_bags',
      'other',
    ]);
    expect(await keys(f.shopB)).toEqual([
      'rent',
      'bijli_gas',
      'staff_salary',
      'staff_advance',
      'petrol',
      'shopping_bags',
      'other',
    ]);
  });

  it('create_shop seeds them too', async () => {
    const shop = randomUUID();
    await asUser(f.outsider, async (q) => {
      await q(
        `select create_shop($1, 'Corner Store', 'grocery', $2, 'Zara', '+923001112223', null, $3)`,
        [shop, randomUUID(), 'pbkdf2-sha256$100000$c2FsdA==$aGFzaA=='],
      );
      const { rows } = await q('select 1 from expense_categories where shop_id = $1', [shop]);
      expect(rows).toHaveLength(7);
    });
  });

  it('owners write categories; cashiers read only', async () => {
    const cat = (actor: string) => ({
      id: randomUUID(),
      table: 'expense_categories',
      op: 'upsert',
      actor_staff_id: actor,
      row: {
        id: randomUUID(),
        shop_id: f.shopA,
        name: 'Ice',
        name_ur: 'برف',
        i18n_key: null,
        sort: 9,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
        device_id: f.deviceA,
      },
    });
    await asUser(f.ownerA, async (q) => {
      expect(codes(await push(q, [cat(f.cashierStaffA)]))).toEqual(['forbidden']);
      expect((await push(q, [cat(f.ownerStaffA)])).errors).toEqual([]);
    });
    await asUser(f.cashierA, async (q) => {
      expect((await q('select 1 from expense_categories')).rowCount).toBeGreaterThan(0);
      expect(codes(await push(q, [cat(f.cashierStaffA)]))).toEqual(['forbidden']);
    });
  });
});

describe('expenses (US046)', () => {
  it('a cashier adds; an approver must be an owner', async () => {
    await asUser(f.cashierA, async (q) => {
      expect((await push(q, [expense().entry])).errors).toEqual([]);
      expect(
        (
          await push(q, [
            expense({ amount_paisa: 300_000, approved_by_staff_id: f.ownerStaffA }).entry,
          ])
        ).errors,
      ).toEqual([]);
      expect(
        codes(await push(q, [expense({ approved_by_staff_id: f.cashierStaffA }).entry])),
      ).toEqual(['invalid']);
    });
  });

  it('refuses zero amounts and unknown methods; riders can neither add nor see', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(codes(await push(q, [expense({ amount_paisa: 0 }).entry]))).toEqual(['invalid']);
      expect(codes(await push(q, [expense({ paid_method_code: 'crypto' }).entry]))).toEqual([
        'missing_parent',
      ]);
    });
    await asUser(riderUser, async (q) => {
      expect(codes(await push(q, [expense().entry]))).toEqual(['forbidden']);
      expect((await q('select 1 from expenses')).rowCount).toBe(0);
      expect((await q('select 1 from expense_categories')).rowCount).toBe(0);
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
      expect(codes(await push(q, [expense({ business_date: '2026-11-20' }).entry]))).toEqual([
        'day_closed',
      ]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('reversals (US066)', () => {
  it('owner only; once only; −original; never a reversal of a reversal', async () => {
    await asUser(f.ownerA, async (q) => {
      const original = expense();
      await push(q, [original.entry]);
      expect(codes(await push(q, [reversal(original.id, -50_000, f.cashierStaffA).entry]))).toEqual(
        ['forbidden'],
      );
      expect(codes(await push(q, [reversal(original.id, -40_000).entry]))).toEqual(['invalid']);
      const first = reversal(original.id);
      expect((await push(q, [first.entry])).errors).toEqual([]);
      expect(codes(await push(q, [reversal(original.id).entry]))).toEqual(['invalid']); // unique
      expect(codes(await push(q, [reversal(first.id, 50_000).entry]))).toEqual(['invalid']);
      // No reason / positive amount with a reversal link: refused by the sign check.
      expect(
        codes(
          await push(q, [
            expense({ reverses_expense_id: original.id, amount_paisa: -50_000 }, f.ownerStaffA)
              .entry,
          ]),
        ),
      ).toEqual(['invalid']);
    });
  });

  it('an original from another shop is not found (retried as missing_parent)', async () => {
    let other = '';
    await asUser(f.ownerB, async (q) => {
      const cat = (
        await q<{ id: string }>('select id from expense_categories where shop_id = $1 limit 1', [
          f.shopB,
        ])
      ).rows[0]!.id;
      other = randomUUID();
      await q('select seed_payment_methods($1)', [f.shopB]).catch(() => undefined);
      await admin.query('select seed_payment_methods($1)', [f.shopB]);
      await q(
        `insert into expenses (id, shop_id, business_date, category_id, amount_paisa, paid_method_code, staff_id, created_at)
         values ($1, $2, '2026-11-22', $3, 100, 'cash', $4, now())`,
        [other, f.shopB, cat, f.ownerStaffB],
      );
    });
    await asUser(f.ownerA, async (q) => {
      expect(codes(await push(q, [reversal(other, -100).entry]))).toEqual(['missing_parent']);
    });
  });

  it('append-only; shop isolation; push / pull round trip', async () => {
    await asUser(f.cashierA, async (q) => {
      const e = expense({ note: 'bags' });
      await push(q, [e.entry]);
      await expect(q('update expenses set note = null')).rejects.toMatchObject({ code: '42501' });
      await expect(q('delete from expenses')).rejects.toMatchObject({ code: '42501' });
      const { rows } = await q<{ r: { rows: { table: string; row: Record<string, unknown> }[] } }>(
        'select sync_pull($1, 0, 1000) as r',
        [f.deviceA],
      );
      const pulled = rows[0]!.r.rows;
      expect(pulled.find((r) => r.table === 'expenses' && r.row.id === e.id)?.row.note).toBe(
        'bags',
      );
      expect(pulled.some((r) => r.table === 'expense_categories')).toBe(true);
      await q(`select set_config('app.user_id', $1, true)`, [f.ownerB]);
      expect((await q('select 1 from expenses where shop_id = $1', [f.shopA])).rowCount).toBe(0);
    });
  });
});
