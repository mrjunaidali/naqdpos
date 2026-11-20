// products.icon (migration 20261121180000): the emoji check, push and pull.
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
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const insert = (q: Query, icon: string | null) =>
  q(`insert into products (id, shop_id, name, unit, icon) values ($1, $2, 'X', 'kg', $3)`, [
    randomUUID(),
    f.shopA,
    icon,
  ]);

describe('products.icon check', () => {
  it.each([
    ['potato', '🥔'],
    ['chilli with variation selector', '🌶️'],
    ['ginger (newer emoji)', '🫚'],
    ['leafy green', '🥬'],
    ['herb', '🌿'],
    ['zero-width joiner sequence', '🧑‍🌾'],
  ])('accepts %s', async (_, icon) => {
    await asUser(f.ownerA, async (q) => expect((await insert(q, icon)).rowCount).toBe(1));
  });

  it('accepts no icon', async () => {
    await asUser(f.ownerA, async (q) => expect((await insert(q, null)).rowCount).toBe(1));
  });

  it.each([
    ['English text', 'potato'],
    ['Urdu text', 'آلو'],
    ['digits', '12'],
    ['an emoji with text', '🥔 aloo'],
    ['a space', ' '],
    ['an empty string', ''],
    // 16 counts characters (code points), as Postgres char_length does.
    ['more than 16 characters', '🥔'.repeat(17)],
  ])('refuses %s', async (_, icon) => {
    await asUser(f.ownerA, async (q) => expect(await errorCode(insert(q, icon))).toBe('23514'));
  });
});

describe('icon sync', () => {
  it('is pushed and pulled', async () => {
    await asUser(f.ownerA, async (q) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      const entry = {
        id: randomUUID(),
        table: 'products',
        op: 'upsert',
        actor_staff_id: f.ownerStaffA,
        row: {
          id,
          shop_id: f.shopA,
          name: 'Potato',
          unit: 'kg',
          icon: '🥔',
          created_at: now,
          updated_at: now,
        },
      };
      const { rows } = await q<{ r: { accepted: string[] } }>(
        'select sync_push($1, $2::jsonb) as r',
        [f.deviceA, JSON.stringify([entry])],
      );
      expect(rows[0]!.r.accepted).toEqual([entry.id]);

      const pulled = await q<{
        r: { rows: { table: string; row: { id: string; icon: string | null } }[] };
      }>('select sync_pull($1, 0, 1000) as r', [f.deviceA]);
      const row = pulled.rows[0]!.r.rows.find((r) => r.table === 'products' && r.row.id === id);
      expect(row?.row.icon).toBe('🥔');
    });
  });

  it('an older app that sends no icon keeps the stored one', async () => {
    await asUser(f.ownerA, async (q) => {
      const id = randomUUID();
      await q(
        `insert into products (id, shop_id, name, unit, icon) values ($1, $2, 'Tomato', 'kg', '🍅')`,
        [id, f.shopA],
      );
      const later = new Date(Date.now() + 60_000).toISOString();
      const entry = {
        id: randomUUID(),
        table: 'products',
        op: 'upsert',
        actor_staff_id: f.ownerStaffA,
        row: { id, shop_id: f.shopA, name: 'Tomato (desi)', unit: 'kg', updated_at: later },
      };
      await q('select sync_push($1, $2::jsonb)', [f.deviceA, JSON.stringify([entry])]);
      const { rows } = await q<{ name: string; icon: string }>(
        'select name, icon from products where id = $1',
        [id],
      );
      expect(rows[0]).toEqual({ name: 'Tomato (desi)', icon: '🍅' });
    });
  });
});
