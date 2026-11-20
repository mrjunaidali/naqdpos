// Owner PIN reset (migration 20261121150000): who may reset, code-send limits, the write and its
// audit row, and other devices pulling the new PIN.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, errorCode, type Fixture } from './helpers.ts';

const HASH = 'pbkdf2-sha256$1000$bmV3c2FsdA==$bmV3aGFzaA==';

let f: Fixture;
let riderUser: string;
let riderStaff: string;
let unlinkedOwnerStaff: string;

beforeAll(async () => {
  f = await createFixture(); // ownerStaffA is linked to ownerA (as create_shop does)
  riderUser = randomUUID();
  riderStaff = randomUUID();
  unlinkedOwnerStaff = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q(`insert into users (id, name, email) values ($1, 'Rider', $2)`, [
    riderUser,
    `${riderUser}@example.test`,
  ]);
  await q(`insert into memberships (shop_id, user_id, role) values ($1, $2, 'rider')`, [
    f.shopA,
    riderUser,
  ]);
  await q(
    `insert into staff (id, shop_id, name, role, membership_user_id) values
       ($1, $2, 'Rider', 'rider', $3), ($4, $2, 'Second owner', 'owner', null)`,
    [riderStaff, f.shopA, riderUser, unlinkedOwnerStaff],
  );
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

/** Runs one statement as `userId` and COMMITS (audit_log is only readable by the owner role). */
async function committed<T extends Record<string, unknown>>(
  userId: string,
  text: string,
  values: unknown[],
) {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const result = await client.query<T>(text, values);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const RESET = 'select staff_id, pin_hash, server_seq from reset_owner_pin($1, $2)';
const REQUEST = 'select request_pin_reset_code($1) as r';

describe('reset_owner_pin', () => {
  it('resets the signed-in owner’s own PIN, bumps server_seq and audits without secrets', async () => {
    const first = await committed<{ pin_hash: string; server_seq: string }>(f.ownerA, RESET, [
      f.ownerStaffA,
      HASH,
    ]);
    expect(first[0]?.pin_hash).toBe(HASH);
    const again = await committed<{ server_seq: string }>(f.ownerA, RESET, [f.ownerStaffA, HASH]);
    expect(Number(again[0]!.server_seq)).toBeGreaterThan(Number(first[0]!.server_seq));

    const { rows } = await admin.query<{ payload: Record<string, unknown> }>(
      `select payload from audit_log where action = 'pin.reset' and entity_id = $1`,
      [f.ownerStaffA],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.payload).toEqual({ staff_id: f.ownerStaffA });
    expect(JSON.stringify(rows)).not.toContain('pbkdf2');
  });

  it('lets the shop’s other devices pull the new PIN', async () => {
    await committed(f.ownerA, RESET, [f.ownerStaffA, HASH]);
    await asUser(f.ownerA, async (q) => {
      const { rows } = await q<{
        r: { rows: { table: string; row: { staff_id: string; pin_hash: string } }[] };
      }>('select sync_pull($1, 0, 1000) as r', [f.deviceA]);
      const pin = rows[0]!.r.rows.find(
        (r) => r.table === 'staff_pins' && r.row.staff_id === f.ownerStaffA,
      );
      expect(pin?.row.pin_hash).toBe(HASH);
    });
  });

  it('refuses cashiers, riders, other shops’ owners, unlinked and inactive owner rows, and no user', async () => {
    const refused = async (user: string | null, staff: string) =>
      asUser(user, async (q) => {
        expect(await errorCode(q(RESET, [staff, HASH]))).toBe('42501');
        expect(await errorCode(q(REQUEST, [staff]))).toBe('42501');
      });
    await refused(f.cashierA, f.cashierStaffA);
    await refused(f.cashierA, f.ownerStaffA);
    await refused(riderUser, riderStaff);
    await refused(f.ownerB, f.ownerStaffA);
    await refused(f.ownerA, unlinkedOwnerStaff);
    await refused(null, f.ownerStaffA);
    await asUser(f.ownerA, async (q) => {
      await q('update staff set active = false where id = $1', [f.ownerStaffA]);
      expect(await errorCode(q(RESET, [f.ownerStaffA, HASH]))).toBe('42501');
    });
  });

  it('refuses a malformed hash', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q(RESET, [f.ownerStaffA, 'plain-pin']))).toBe('23514');
    });
  });
});

describe('request_pin_reset_code limits', () => {
  it('allows one code per 60 seconds', async () => {
    // Use shop B's owner so the rows from other tests do not count.
    await expect(committed<{ r: string }>(f.ownerB, REQUEST, [f.ownerStaffB])).resolves.toEqual([
      { r: 'ok' },
    ]);
    await expect(committed<{ r: string }>(f.ownerB, REQUEST, [f.ownerStaffB])).resolves.toEqual([
      { r: 'cooldown' },
    ]);
    await admin.query(
      `update audit_log set at = now() - interval '61 seconds' where actor_user_id = $1 and action = 'pin.code_sent'`,
      [f.ownerB],
    );
    await expect(committed<{ r: string }>(f.ownerB, REQUEST, [f.ownerStaffB])).resolves.toEqual([
      { r: 'ok' },
    ]);
  });

  it('allows at most 10 codes per 24 hours', async () => {
    await admin.query(
      `delete from audit_log where actor_user_id = $1 and action = 'pin.code_sent'`,
      [f.ownerB],
    );
    await admin.query(
      `insert into audit_log (shop_id, actor_user_id, action, entity, entity_id, at)
       select $1, $2, 'pin.code_sent', 'staff', $3, now() - (n || ' minutes')::interval
       from generate_series(2, 11) n`,
      [f.shopB, f.ownerB, f.ownerStaffB],
    );
    await expect(committed<{ r: string }>(f.ownerB, REQUEST, [f.ownerStaffB])).resolves.toEqual([
      { r: 'daily_cap' },
    ]);
    // Older than 24 hours no longer counts.
    await admin.query(
      `update audit_log set at = now() - interval '25 hours' where actor_user_id = $1 and action = 'pin.code_sent'`,
      [f.ownerB],
    );
    await expect(committed<{ r: string }>(f.ownerB, REQUEST, [f.ownerStaffB])).resolves.toEqual([
      { r: 'ok' },
    ]);
  });

  it('records each allowed send without secrets', async () => {
    const { rows } = await admin.query<{ payload: unknown }>(
      `select payload from audit_log where actor_user_id = $1 and action = 'pin.code_sent'`,
      [f.ownerB],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.payload === null)).toBe(true);
  });
});
