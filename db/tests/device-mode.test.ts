// set_device_mode (migration 20261121120000): owner only, audit-logged, bumps server_seq.
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
  f = await createFixture(); // f.deviceA: shop A counter, mode 'shop'
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const CALL = 'select id, mode, server_seq from set_device_mode($1, $2)';
const seq = async (q: Query, id: string) =>
  Number(
    (await q<{ server_seq: string }>('select server_seq from devices where id = $1', [id])).rows[0]!
      .server_seq,
  );

describe('set_device_mode', () => {
  it('lets the owner switch a shop counter to an owner phone and back', async () => {
    await asUser(f.ownerA, async (q) => {
      const before = await seq(q, f.deviceA);
      const { rows } = await q<{ mode: string }>(CALL, [f.deviceA, 'owner']);
      expect(rows[0]?.mode).toBe('owner');
      expect(await seq(q, f.deviceA)).toBeGreaterThan(before);
      const back = await q<{ mode: string }>(CALL, [f.deviceA, 'shop']);
      expect(back.rows[0]?.mode).toBe('shop');
    });
  });

  it('writes an audit row with the old and new mode', async () => {
    // audit_log has no client privileges: commit one change, then read it as the owner role.
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [f.ownerA]);
      await client.query(CALL, [f.deviceA, 'owner']);
      await client.query('commit');
    } finally {
      client.release();
    }
    const { rows } = await admin.query<{ payload: { from: string; to: string } }>(
      `select payload from audit_log where entity_id = $1 and action = 'device.mode'`,
      [f.deviceA],
    );
    expect(rows.map((r) => r.payload)).toEqual([{ from: 'shop', to: 'owner' }]);
    await admin.query(`update devices set mode = 'shop' where id = $1`, [f.deviceA]);
  });

  it('a retry with the same mode changes nothing', async () => {
    await asUser(f.ownerA, async (q) => {
      const before = await seq(q, f.deviceA);
      await q(CALL, [f.deviceA, 'shop']);
      expect(await seq(q, f.deviceA)).toBe(before);
    });
  });

  it('refuses a cashier, another shop’s owner, an unknown device and no user', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(await errorCode(q(CALL, [f.deviceA, 'owner']))).toBe('42501');
    });
    await asUser(f.ownerB, async (q) => {
      expect(await errorCode(q(CALL, [f.deviceA, 'owner']))).toBe('42501');
    });
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q(CALL, [randomUUID(), 'owner']))).toBe('42501');
    });
    await asUser(null, async (q) => {
      expect(await errorCode(q(CALL, [f.deviceA, 'owner']))).toBe('42501');
    });
  });

  it('refuses an unknown mode', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q(CALL, [f.deviceA, 'boss']))).toBe('23514');
    });
  });
});
