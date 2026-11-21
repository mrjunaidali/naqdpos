// Shop profile columns and checks (migration 20261122180000).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

interface PushResult {
  accepted: string[];
  errors: { id: string; code: string }[];
}
const push = async (q: Query, row: Record<string, unknown>, actor: string) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      f.deviceA,
      JSON.stringify([
        {
          id: randomUUID(),
          table: 'shops',
          op: 'upsert',
          actor_staff_id: actor,
          row: { id: f.shopA, updated_at: new Date().toISOString(), ...row },
        },
      ]),
    ])
  ).rows[0]!.r;
const codes = (r: PushResult) => r.errors.map((e) => e.code);

describe('shop profile (US014)', () => {
  it('defaults to English receipts on 58 mm paper', async () => {
    const { rows } = await admin.query<{ receipt_language: string; paper_width_mm: number }>(
      'select receipt_language, paper_width_mm from shops where id = $1',
      [f.shopA],
    );
    expect(rows[0]).toEqual({ receipt_language: 'en', paper_width_mm: 58 });
  });

  it('the owner saves the profile; values are checked', async () => {
    await asUser(f.ownerA, async (q) => {
      const ok = await push(
        q,
        {
          name: 'Ali Fruit',
          address: 'Main Bazaar',
          phone: '0300 1234567',
          receipt_footer: 'Thank you!\nShukriya',
          receipt_language: 'both',
          paper_width_mm: 80,
        },
        f.ownerStaffA,
      );
      expect(ok.errors).toEqual([]);
      for (const bad of [
        { receipt_language: 'fr' },
        { paper_width_mm: 72 },
        { receipt_footer: 'x'.repeat(201) },
        { name: ' ' },
        { address: 'x'.repeat(201) },
      ]) {
        expect(codes(await push(q, bad, f.ownerStaffA)), JSON.stringify(bad)).toEqual(['invalid']);
      }
      const { rows } = await q<{ r: { rows: { table: string; row: Record<string, unknown> }[] } }>(
        'select sync_pull($1, 0, 1000) as r',
        [f.deviceA],
      );
      expect(rows[0]!.r.rows.find((r) => r.table === 'shops')?.row).toMatchObject({
        receipt_language: 'both',
        paper_width_mm: 80,
        receipt_footer: 'Thank you!\nShukriya',
      });
    });
  });

  it('only the owner: a cashier actor is refused, a cashier session updates nothing', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(codes(await push(q, { receipt_language: 'ur' }, f.cashierStaffA))).toEqual([
        'forbidden',
      ]);
    });
    await asUser(f.cashierA, async (q) => {
      const r = await q('update shops set paper_width_mm = 80 where id = $1', [f.shopA]);
      expect(r.rowCount).toBe(0);
    });
  });
});
