// day_closes, is_day_closed(), shop_expected_cash() (migration 20261123090000).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../packages/core/src/fixtures/expected-cash.json' with { type: 'json' };
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;
let deviceB: string;
let riderUser: string;
let rent: string;

beforeAll(async () => {
  f = await createFixture();
  deviceB = randomUUID();
  riderUser = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q('select seed_payment_methods($1), seed_expense_categories($1)', [f.shopA]);
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
const push = async (q: Query, entries: unknown[], device = f.deviceA) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      device,
      JSON.stringify(entries),
    ])
  ).rows[0]!.r;
const codes = (r: PushResult) => r.errors.map((e) => e.code);
const entry = (table: string, row: Record<string, unknown>, actor: string) => ({
  id: randomUUID(),
  table,
  op: 'insert',
  actor_staff_id: actor,
  row,
});

function close(date: string, actor = f.ownerStaffA, over: Record<string, unknown> = {}) {
  return entry(
    'day_closes',
    {
      id: randomUUID(),
      shop_id: f.shopA,
      business_date: date,
      opening_cash_paisa: 100_000,
      expected_cash_paisa: 121_500,
      counted_cash_paisa: 121_000,
      difference_paisa: -500,
      owner_withdrawal_paisa: 0,
      note: null,
      closed_by_staff_id: actor,
      closed_at: new Date().toISOString(),
      seen_through_seq: 0,
      device_id: f.deviceA,
      ...over,
    },
    actor,
  );
}

describe('day_closes (US044)', () => {
  it('the owner closes; is_day_closed becomes true; one close per date', async () => {
    await asUser(f.ownerA, async (q) => {
      expect((await push(q, [close('2026-11-01')])).errors).toEqual([]);
      const { rows } = await q<{ closed: boolean }>(
        `select is_day_closed($1, '2026-11-01') as closed`,
        [f.shopA],
      );
      expect(rows[0]!.closed).toBe(true);
      expect(codes(await push(q, [close('2026-11-01')]))).toEqual(['invalid']);
    });
  });

  it('only owners: a cashier actor or a cashier session is refused; never a future day', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(codes(await push(q, [close('2026-11-02', f.cashierStaffA)]))).toEqual(['forbidden']);
      expect(codes(await push(q, [close('2099-01-01')]))).toEqual(['invalid']);
      expect(
        codes(await push(q, [close('2026-11-03', f.ownerStaffA, { difference_paisa: 0 })])),
      ).toEqual(['invalid']); // difference must be counted − expected
    });
    await asUser(f.cashierA, async (q) => {
      expect(codes(await push(q, [close('2026-11-04', f.cashierStaffA)]))).toEqual(['forbidden']);
      await expect(
        q(
          `insert into day_closes (id, shop_id, business_date, opening_cash_paisa, expected_cash_paisa,
             counted_cash_paisa, difference_paisa, closed_by_staff_id, closed_at, seen_through_seq)
           values ($1, $2, '2026-11-05', 0, 0, 0, 0, $3, now(), 0)`,
          [randomUUID(), f.shopA, f.cashierStaffA],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('a late row from another device is accepted and shows as not seen at closing', async () => {
    await asUser(f.ownerA, async (q) => {
      const cursor = Number(
        (await q<{ s: string }>('select coalesce(max(server_seq), 0)::text as s from expenses'))
          .rows[0]!.s,
      );
      // 9 pm: the owner phone closes, having seen everything up to `cursor`.
      expect(
        (await push(q, [close('2026-11-10', f.ownerStaffA, { seen_through_seq: cursor })])).errors,
      ).toEqual([]);
      // 10 pm: the counter pushes its 8 pm expense for that date.
      const late = entry(
        'expenses',
        {
          id: randomUUID(),
          shop_id: f.shopA,
          business_date: '2026-11-10',
          category_id: rent,
          amount_paisa: 5_000,
          paid_method_code: 'cash',
          staff_id: f.cashierStaffA,
          created_at: new Date().toISOString(),
          device_id: deviceB,
        },
        f.cashierStaffA,
      );
      expect((await push(q, [late], deviceB)).errors).toEqual([]);
      const { rows } = await q<{ n: string }>(
        `select count(*)::text as n from expenses e join day_closes d
           on d.shop_id = e.shop_id and d.business_date = e.business_date
         where e.business_date = '2026-11-10' and e.server_seq > d.seen_through_seq
           and not (e.device_id = d.device_id and e.created_at <= d.closed_at)`,
      );
      expect(rows[0]!.n).toBe('1');
    });
  });

  it('shop_expected_cash matches expectedCash (shared fixture)', async () => {
    await asUser(f.ownerA, async (q) => {
      const date = '2026-11-12';
      const customer = randomUUID();
      await q(
        `insert into customers (id, shop_id, mobile, updated_at) values ($1, $2, '+923009990001', now())`,
        [customer, f.shopA],
      );
      const saleId = randomUUID();
      await q(
        `insert into sales (id, shop_id, receipt_no, business_date, staff_id, subtotal_paisa, total_paisa, created_at)
         values ($1, $2, 'F1-000001', $3, $4, 26500, 26500, now())`,
        [saleId, f.shopA, date, f.ownerStaffA],
      );
      for (const p of fixture.payments) {
        await q(
          `insert into payments (id, shop_id, business_date, kind, sale_id, customer_id, method_code, amount_paisa, staff_id, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
          [
            randomUUID(),
            f.shopA,
            date,
            p.kind,
            p.kind === 'sale' ? saleId : null,
            p.kind === 'khata_receipt' ? customer : null,
            p.method_code,
            p.amount_paisa,
            f.ownerStaffA,
          ],
        );
      }
      let original: string | null = null;
      for (const e of fixture.expenses) {
        const id = randomUUID();
        const reversal = 'reversal' in e && e.reversal;
        await q(
          `insert into expenses (id, shop_id, business_date, category_id, amount_paisa, paid_method_code,
             staff_id, reverses_expense_id, reversal_reason, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
          [
            id,
            f.shopA,
            date,
            rent,
            e.amount_paisa,
            e.paid_method_code,
            f.ownerStaffA,
            reversal ? original : null,
            reversal ? 'wrong' : null,
          ],
        );
        original = id;
      }
      const { rows } = await q<{ v: string }>(
        'select shop_expected_cash($1, $2, $3, $4)::text as v',
        [f.shopA, date, fixture.opening_paisa, fixture.withdrawal_paisa],
      );
      expect(Number(rows[0]!.v)).toBe(fixture.expected_paisa);
    });
  });

  it('append-only; riders see nothing; push / pull round trip', async () => {
    await asUser(f.ownerA, async (q) => {
      const c = close('2026-11-15');
      await push(q, [c]);
      await expect(q('update day_closes set note = $1', ['x'])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(q('delete from day_closes')).rejects.toMatchObject({ code: '42501' });
      const { rows } = await q<{ r: { rows: { table: string; row: Record<string, unknown> }[] } }>(
        'select sync_pull($1, 0, 1000) as r',
        [f.deviceA],
      );
      expect(
        rows[0]!.r.rows.find(
          (r) => r.table === 'day_closes' && r.row.id === (c.row as { id: string }).id,
        )?.row,
      ).toMatchObject({ business_date: '2026-11-15', seen_through_seq: 0, difference_paisa: -500 });
      await q(`select set_config('app.user_id', $1, true)`, [riderUser]);
      expect((await q('select 1 from day_closes')).rowCount).toBe(0);
    });
  });
});
