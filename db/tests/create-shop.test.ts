import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, errorCode, type Fixture } from './helpers.ts';

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const CALL = `select create_shop($1, 'New shop', 'meat', $2, 'Owner', '03001234567', '03007654321', 'Main road', $3) as id`;

describe('create_shop', () => {
  it('creates shop, owner membership, owner staff and an audit row in one call', async () => {
    const shopId = randomUUID();
    const staffId = randomUUID();
    const deviceId = randomUUID();
    await asUser(f.outsider, async (q) => {
      const { rows } = await q<{ id: string }>(CALL, [shopId, staffId, deviceId]);
      expect(rows[0]?.id).toBe(shopId);

      const shop = await q('select name, type, phone, address, device_id from shops');
      expect(shop.rows).toEqual([
        {
          name: 'New shop',
          type: 'meat',
          phone: '03007654321',
          address: 'Main road',
          device_id: deviceId,
        },
      ]);
      const membership = await q('select user_id, role from memberships');
      expect(membership.rows).toEqual([{ user_id: f.outsider, role: 'owner' }]);
      const staff = await q('select id, role, membership_user_id, phone from staff');
      expect(staff.rows).toEqual([
        { id: staffId, role: 'owner', membership_user_id: f.outsider, phone: '03001234567' },
      ]);
      // The new owner can edit right away.
      expect((await q(`update shops set name = 'Renamed' where id = $1`, [shopId])).rowCount).toBe(
        1,
      );
    });
  });

  it('a retry by the same owner returns the id without duplicating rows', async () => {
    const shopId = randomUUID();
    const staffId = randomUUID();
    await asUser(f.outsider, async (q) => {
      await q(CALL, [shopId, staffId, null]);
      const { rows } = await q<{ id: string }>(CALL, [shopId, staffId, null]);
      expect(rows[0]?.id).toBe(shopId);
      expect((await q('select 1 from staff where shop_id = $1', [shopId])).rowCount).toBe(1);
    });
  });

  it('another user reusing the shop id gets 23505', async () => {
    await asUser(f.ownerB, async (q) => {
      expect(await errorCode(q(CALL, [f.shopA, randomUUID(), null]))).toBe('23505');
    });
  });

  it('writes an audit_log row (readable only by the owner role)', async () => {
    const shopId = randomUUID();
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [f.outsider]);
      await client.query(CALL, [shopId, randomUUID(), null]);
      await client.query('commit');
    } finally {
      client.release();
    }
    const { rows } = await admin.query(
      'select actor_user_id, action, entity from audit_log where shop_id = $1',
      [shopId],
    );
    expect(rows).toEqual([{ actor_user_id: f.outsider, action: 'shop.create', entity: 'shops' }]);
  });
});
