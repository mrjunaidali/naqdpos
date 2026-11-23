// Owner report functions (migration 20261124090000, US047–US049, US068) against the shared fixture
// packages/core/src/fixtures/report-month.json: the SQL must give the same numbers as core.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../packages/core/src/fixtures/report-month.json' with { type: 'json' };
import { admin, app, asUser, createFixture, type Fixture } from './helpers.ts';

let f: Fixture;
let deviceB: string;
let riderUser: string;
const { from, to, today, expected } = fixture;
const ids = () => ({
  $shop: f.shopA,
  $owner: f.ownerStaffA,
  $cashier: f.cashierStaffA,
  $devA: f.deviceA,
  $devB: deviceB,
});

/** Replaces "$shop", "$owner", … in a fixture value with this run's ids. */
function resolve<T>(value: T): T {
  const map: Record<string, string> = ids();
  return JSON.parse(JSON.stringify(value), (_k, v: unknown) =>
    typeof v === 'string' && v in map ? map[v] : v,
  ) as T;
}

/** Inserts the fixture as the owner (ledger triggers check the acting user). */
async function seed() {
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true)`, [f.ownerA]);
    const insert = async (table: string, row: Record<string, unknown>) => {
      const cols = Object.keys(row);
      await client.query(
        `insert into ${table} (shop_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [f.shopA, ...cols.map((c) => row[c])],
      );
    };
    await client.query('select seed_payment_methods($1)', [f.shopA]);
    for (const p of fixture.products) await insert('products', { ...p, search_terms: [] });
    for (const c of fixture.costs) await insert('product_cost_history', c);
    for (const c of fixture.categories)
      await insert('expense_categories', { id: c.id, name: c.name, name_ur: c.name_ur });
    for (const c of fixture.customers) await insert('customers', c);
    for (const s of resolve(fixture.sales))
      await insert('sales', { ...s, order_type: 'walk_in', source: 'walk_in' });
    for (const l of fixture.lines) {
      const sale = fixture.sales.find((s) => s.id === l.sale_id)!;
      await insert('sale_lines', {
        ...resolve(l),
        created_at: sale.created_at,
        device_id: resolve(sale.device_id),
      });
    }
    for (const p of resolve(fixture.payments)) await insert('payments', p);
    for (const k of resolve(fixture.khata)) await insert('khata_entries', k);
    for (const m of resolve(fixture.movements)) await insert('stock_movements', m);
    for (const e of resolve(fixture.expenses)) await insert('expenses', e);
    for (const d of fixture.closed_dates)
      await insert('day_closes', {
        id: randomUUID(),
        business_date: d,
        opening_cash_paisa: 0,
        expected_cash_paisa: 0,
        counted_cash_paisa: 0,
        difference_paisa: 0,
        owner_withdrawal_paisa: 0,
        closed_by_staff_id: f.ownerStaffA,
        closed_at: `${d}T17:00:00Z`,
        seen_through_seq: 0,
        device_id: f.deviceA,
      });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  f = await createFixture();
  deviceB = randomUUID();
  riderUser = randomUUID();
  await admin.query(
    `insert into devices (id, shop_id, name, code, registered_by) values ($1, $2, 'Counter 2', 'B1', $3)`,
    [deviceB, f.shopA, f.ownerA],
  );
  await admin.query(`insert into users (id, name, email) values ($1, 'Rider', $2)`, [
    riderUser,
    `${riderUser}@example.test`,
  ]);
  await admin.query(`insert into memberships (shop_id, user_id, role) values ($1, $2, 'rider')`, [
    f.shopA,
    riderUser,
  ]);
  await seed();
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const asOwner = <R>(text: string, values: unknown[]) =>
  asUser(f.ownerA, async (q) => (await q<{ r: R }>(text, values)).rows[0]!.r);

describe('report functions agree with core on the shared fixture', () => {
  it('report_summary', async () => {
    const r = await asOwner('select report_summary($1, $2, $3, $4) as r', [
      f.shopA,
      from,
      to,
      today,
    ]);
    expect(r).toEqual(expected.summary);
  });

  it('report_products: cost at sale time, FOC cost, by_amount qty, custom items grouped and flagged', async () => {
    const r = await asOwner<unknown[]>('select report_products($1, $2, $3) as r', [
      f.shopA,
      from,
      to,
    ]);
    expect(r).toEqual(expected.products.map((p) => expect.objectContaining(p) as unknown));
  });

  it('report_staff', async () => {
    const r = await asOwner('select report_staff($1, $2, $3) as r', [f.shopA, from, to]);
    expect(r).toEqual(resolve(expected.staff));
  });

  it('report_expenses: newest first, reversals netted, previous month; names for the list', async () => {
    const r = await asOwner<{
      lines: { id: string; category_name: string; staff_name: string }[];
      line_count: number;
    }>('select report_expenses($1, $2, $3) as r', [f.shopA, from, to]);
    expect(r.lines.map((l) => l.id)).toEqual(expected.expenses.line_ids);
    expect(r).toMatchObject({
      total_paisa: expected.expenses.total_paisa,
      by_category: expected.expenses.by_category,
      by_method: expected.expenses.by_method,
      previous: expected.expenses.previous,
      line_count: 4,
    });
    expect(r.lines[0]).toMatchObject({ category_name: 'Bags', staff_name: 'Cashier A' });
  });

  it('shop_expected_cash agrees with the fixture days', async () => {
    for (const day of expected.expected_cash) {
      const r = await asOwner('select shop_expected_cash($1, $2, $3, $4) as r', [
        f.shopA,
        day.business_date,
        day.opening_paisa,
        day.withdrawal_paisa,
      ]);
      expect(Number(r), day.business_date).toBe(day.expected_paisa);
    }
  });
});

describe('report rules', () => {
  it('expense filters: category, method, staff; previous period of a partial range', async () => {
    const bags = fixture.categories[1]!.id;
    const byCat = await asOwner<{ total_paisa: number; previous: { total_paisa: number } }>(
      'select report_expenses($1, $2, $3, $4) as r',
      [f.shopA, from, to, bags],
    );
    expect(byCat.total_paisa).toBe(30000);
    expect(byCat.previous.total_paisa).toBe(0);
    const jazz = await asOwner<{ total_paisa: number }>(
      'select report_expenses($1, $2, $3, null, $4) as r',
      [f.shopA, from, to, 'jazzcash'],
    );
    expect(jazz.total_paisa).toBe(30000);
    const cashier = await asOwner<{ lines: { id: string }[] }>(
      'select report_expenses($1, $2, $3, null, null, $4) as r',
      [f.shopA, from, to, f.cashierStaffA],
    );
    expect(cashier.lines.map((l) => l.id)).toEqual([
      expected.expenses.line_ids[0],
      expected.expenses.line_ids[2],
    ]);
    const week = await asOwner<{ previous: { from: string; to: string } }>(
      'select report_expenses($1, $2, $3) as r',
      [f.shopA, '2026-10-10', '2026-10-16'],
    );
    expect(week.previous).toMatchObject({ from: '2026-10-03', to: '2026-10-09' });
  });

  it('today (in range, not closed) is still open, not an unclosed day', async () => {
    const r = await asOwner<{ unclosed_days: string[]; today_open: boolean }>(
      'select report_summary($1, $2, $3, $4) as r',
      [f.shopA, from, to, '2026-10-20'],
    );
    expect(r).toMatchObject({ unclosed_days: [], today_open: true });
  });

  it('a range in September sees only September (receivables as of its end)', async () => {
    const r = await asOwner<{
      sales_count: number;
      receivables_paisa: number;
      costed_sales_paisa: number;
    }>('select report_summary($1, $2, $3, $4) as r', [f.shopA, '2026-09-01', '2026-09-30', today]);
    expect(r).toMatchObject({ sales_count: 1, receivables_paisa: 5000, costed_sales_paisa: 30000 });
  });

  it('owner only: cashier, rider, outsider and another shop owner are refused; range limits', async () => {
    const calls = [
      ['select report_summary($1, $2, $3)', [f.shopA, from, to]],
      ['select report_products($1, $2, $3)', [f.shopA, from, to]],
      ['select report_staff($1, $2, $3)', [f.shopA, from, to]],
      ['select report_expenses($1, $2, $3)', [f.shopA, from, to]],
      ['select count(*) from report_lines($1, $2, $3)', [f.shopA, from, to]],
    ] as const;
    for (const user of [f.cashierA, riderUser, f.outsider, f.ownerB]) {
      for (const [text, values] of calls) {
        const code = await asUser(user, (q) => q(text, [...values])).then(
          () => 'ok',
          (e: { code?: string }) => e.code,
        );
        expect(code, `${text} as ${user}`).toBe('42501');
      }
    }
    for (const [a, b] of [
      ['2026-01-01', '2027-01-02'],
      ['2026-10-02', '2026-10-01'],
    ]) {
      const code = await asUser(f.ownerA, (q) =>
        q('select report_summary($1, $2, $3)', [f.shopA, a, b]),
      ).then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
      expect(code).toBe('22023');
    }
    // 366 days is allowed.
    const ok = await asOwner<{ sales_count: number }>('select report_summary($1, $2, $3) as r', [
      f.shopA,
      '2026-01-01',
      '2027-01-01',
    ]);
    expect(ok.sales_count).toBe(5);
  });
});
