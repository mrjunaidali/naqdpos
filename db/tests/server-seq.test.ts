import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;

/** server_seq of one row; bigint arrives as a string from pg. */
async function seqOf(q: Query, table: string, id: string): Promise<bigint> {
  const idColumn = table === 'staff_salaries' ? 'staff_id' : 'id';
  const { rows } = await q<{ server_seq: string }>(
    `select server_seq from ${table} where ${idColumn} = $1`,
    [id],
  );
  if (!rows[0]) throw new Error(`no ${table} row ${id}`);
  return BigInt(rows[0].server_seq);
}
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('server_seq (architecture §2, §4)', () => {
  it('increases on every insert and update, across tables', async () => {
    await asUser(f.ownerA, async (q) => {
      const seq = (table: string, id: string) => seqOf(q, table, id);

      const before = await seq('shops', f.shopA);

      const staffId = randomUUID();
      await q(`insert into staff (id, shop_id, name, role) values ($1, $2, 'S', 'cashier')`, [
        staffId,
        f.shopA,
      ]);
      const inserted = await seq('staff', staffId);
      expect(inserted).toBeGreaterThan(before);

      await q(`update staff set name = 'S2' where id = $1`, [staffId]);
      const updated = await seq('staff', staffId);
      expect(updated).toBeGreaterThan(inserted);

      await q(`update shops set name = 'Shop A3' where id = $1`, [f.shopA]);
      expect(await seq('shops', f.shopA)).toBeGreaterThan(updated);
    });
  });

  it('overwrites a server_seq the client sends', async () => {
    await asUser(f.ownerA, async (q) => {
      const staffId = randomUUID();
      await q(
        `insert into staff (id, shop_id, name, role, server_seq) values ($1, $2, 'S', 'cashier', 999999999)`,
        [staffId, f.shopA],
      );
      const first = await seqOf(q, 'staff', staffId);
      expect(first).toBeLessThan(999999999n);

      await q('update staff set server_seq = 1 where id = $1', [staffId]);
      expect(await seqOf(q, 'staff', staffId)).toBeGreaterThan(first);
    });
  });
});
