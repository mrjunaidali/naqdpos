import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, errorCode, type Fixture } from './helpers.ts';

let f: Fixture;
beforeAll(async () => {
  f = await createFixture(); // shop A already has device A1 (registered by ownerA)
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const CALL = 'select id, shop_id, code, name, registered_by from register_device($1, $2, $3)';

interface Registered {
  id: string;
  shop_id: string;
  code: string;
  name: string;
  registered_by: string;
}

/** Commits, unlike asUser, so concurrent calls really race. */
async function registerCommitted(userId: string, shopId: string, deviceId: string) {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const { rows } = await client.query<Registered>(CALL, [deviceId, shopId, 'Counter']);
    await client.query('commit');
    return rows[0]!;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

describe('register_device', () => {
  it('assigns the next code in the shop to the owner, as the owner', async () => {
    await asUser(f.ownerA, async (q) => {
      const first = randomUUID();
      const { rows } = await q<Registered>(CALL, [first, f.shopA, 'Owner phone']);
      expect(rows[0]).toEqual({
        id: first,
        shop_id: f.shopA,
        code: 'A2',
        name: 'Owner phone',
        registered_by: f.ownerA,
      });
      const second = await q<Registered>(CALL, [randomUUID(), f.shopA, 'Counter PC']);
      expect(second.rows[0]?.code).toBe('A3');
    });
  });

  it('numbers each shop separately', async () => {
    await asUser(f.ownerB, async (q) => {
      const { rows } = await q<Registered>(CALL, [randomUUID(), f.shopB, 'Phone']);
      expect(rows[0]?.code).toBe('A1');
    });
  });

  it('a retry with the same device id returns the same row', async () => {
    await asUser(f.ownerA, async (q) => {
      const id = randomUUID();
      const first = await q<Registered>(CALL, [id, f.shopA, 'Phone']);
      const retry = await q<Registered>(CALL, [id, f.shopA, 'Phone']);
      expect(retry.rows[0]).toEqual(first.rows[0]);
      expect((await q('select 1 from devices where id = $1', [id])).rowCount).toBe(1);
    });
  });

  it('gives different codes to registrations at the same moment', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => registerCommitted(f.ownerB, f.shopB, randomUUID())),
    );
    const codes = results.map((r) => r.code);
    expect(new Set(codes).size).toBe(5);
    expect(codes.every((c) => /^A[0-9]{1,3}$/.test(c))).toBe(true);
  });

  it('a device id already used by another shop gets 23505', async () => {
    await asUser(f.ownerB, async (q) => {
      expect(await errorCode(q(CALL, [f.deviceA, f.shopB, 'Phone']))).toBe('23505');
    });
  });

  it('refuses a cashier, another shop owner, an outsider and no user', async () => {
    for (const user of [f.cashierA, f.ownerB, f.outsider, null]) {
      await asUser(user, async (q) => {
        expect(await errorCode(q(CALL, [randomUUID(), f.shopA, 'Phone'])), String(user)).toBe(
          '42501',
        );
      });
    }
  });

  it('rejects an empty name (check constraint)', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q(CALL, [randomUUID(), f.shopA, '  ']))).toBe('23514');
    });
  });

  it('writes an audit row', async () => {
    const id = randomUUID();
    await registerCommitted(f.ownerA, f.shopA, id);
    const { rows } = await admin.query(
      'select actor_user_id, action from audit_log where entity_id = $1',
      [id],
    );
    expect(rows).toEqual([{ actor_user_id: f.ownerA, action: 'device.register' }]);
  });
});

describe('device codes past A999', () => {
  it('continue with B1', async () => {
    // Fill a fresh shop up to A999 directly as the owner role, then register one more.
    const shopId = randomUUID();
    await admin.query(`insert into shops (id, name, type) values ($1, 'Big', 'general')`, [shopId]);
    await admin.query(`insert into memberships (shop_id, user_id, role) values ($1, $2, 'owner')`, [
      shopId,
      f.outsider,
    ]);
    await admin.query(
      `insert into devices (id, shop_id, name, code)
       select gen_random_uuid(), $1, 'D' || n, 'A' || n from generate_series(1, 999) n`,
      [shopId],
    );
    const row = await registerCommitted(f.outsider, shopId, randomUUID());
    expect(row.code).toBe('B1');
  });
});
