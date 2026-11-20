// staff_pins (migration 20261120170000): RLS, device scopes for pull and push, and the acting-staff
// check on owner-only tables.
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

const HASH = (n: number) => `pbkdf2-sha256$1000$c2FsdA==$aGFzaA${n}=`;

let f: Fixture;
let riderUser: string;
let riderStaff: string;
let ownerDevice: string;
let riderDevice: string;
let staffB2: string;

beforeAll(async () => {
  f = await createFixture(); // f.deviceA is the shop counter (mode 'shop')
  riderUser = randomUUID();
  riderStaff = randomUUID();
  ownerDevice = randomUUID();
  riderDevice = randomUUID();
  staffB2 = randomUUID();
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
    `insert into staff (id, shop_id, name, role, membership_user_id) values ($1, $2, 'Rider', 'rider', $3)`,
    [riderStaff, f.shopA, riderUser],
  );
  await q(
    `insert into staff_pins (staff_id, shop_id, pin_hash) values
       ($1, $4, $5), ($2, $4, $6), ($3, $4, $7), ($8, $9, $10)`,
    [
      f.ownerStaffA,
      f.cashierStaffA,
      riderStaff,
      f.shopA,
      HASH(1),
      HASH(2),
      HASH(3),
      f.ownerStaffB,
      f.shopB,
      HASH(4),
    ],
  );
  await q(`insert into staff (id, shop_id, name, role) values ($1, $2, 'B cashier', 'cashier')`, [
    staffB2,
    f.shopB,
  ]);
  await q(
    `insert into devices (id, shop_id, name, code, registered_by, mode) values
       ($1, $3, 'Owner phone', 'A2', $4, 'owner'), ($2, $3, 'Rider phone', 'A3', $4, 'rider')`,
    [ownerDevice, riderDevice, f.shopA, f.ownerA],
  );
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const pinsVisible = async (q: Query) =>
  (await q<{ staff_id: string }>('select staff_id from staff_pins order by staff_id')).rows
    .map((r) => r.staff_id)
    .sort();

describe('staff_pins RLS', () => {
  it('owners and cashiers read their shop’s PINs; riders only their own', async () => {
    const shopA = [f.ownerStaffA, f.cashierStaffA, riderStaff].sort();
    await asUser(f.ownerA, async (q) => expect(await pinsVisible(q)).toEqual(shopA));
    await asUser(f.cashierA, async (q) => expect(await pinsVisible(q)).toEqual(shopA));
    await asUser(riderUser, async (q) => expect(await pinsVisible(q)).toEqual([riderStaff]));
    await asUser(f.ownerB, async (q) => expect(await pinsVisible(q)).toEqual([f.ownerStaffB]));
  });

  it('only owners write PINs', async () => {
    await asUser(f.cashierA, async (q) => {
      const updated = await q(`update staff_pins set pin_hash = $1 where staff_id = $2`, [
        HASH(9),
        f.cashierStaffA,
      ]);
      expect(updated.rowCount).toBe(0);
      const staffId = randomUUID();
      expect(
        await errorCode(
          q(`insert into staff_pins (staff_id, shop_id, pin_hash) values ($1, $2, $3)`, [
            staffId,
            f.shopA,
            HASH(9),
          ]),
        ),
      ).toBe('42501');
    });
    await asUser(f.ownerA, async (q) => {
      const updated = await q(`update staff_pins set pin_hash = $1 where staff_id = $2`, [
        HASH(9),
        f.cashierStaffA,
      ]);
      expect(updated.rowCount).toBe(1);
    });
  });

  it('cannot point at another shop’s staff member', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(
        await errorCode(
          q(`insert into staff_pins (staff_id, shop_id, pin_hash) values ($1, $2, $3)`, [
            staffB2,
            f.shopA,
            HASH(9),
          ]),
        ),
      ).toBe('23503');
    });
  });

  it('staff.pin_hash is emptied by the migration and no longer pushable', async () => {
    const { rows } = await admin.query<{ push_columns: string[] }>(
      `select push_columns from sync_tables where table_name = 'staff'`,
    );
    expect(rows[0]?.push_columns).not.toContain('pin_hash');
  });
});

interface PullResult {
  rows: { table: string; row: Record<string, unknown> }[];
  has_more: boolean;
  next_seq: number;
}
async function pullTables(q: Query, device: string) {
  const tables = new Set<string>();
  let since = 0;
  for (;;) {
    const { rows } = await q<{ r: PullResult }>('select sync_pull($1, $2, 1000) as r', [
      device,
      since,
    ]);
    const page = rows[0]!.r;
    for (const r of page.rows) tables.add(r.table);
    since = page.next_seq;
    if (!page.has_more) return { tables, rows: page.rows };
  }
}

describe('pulling PINs by device mode', () => {
  it('shop and owner devices get staff_pins; rider devices get none', async () => {
    await asUser(f.ownerA, async (q) => {
      expect((await pullTables(q, f.deviceA)).tables.has('staff_pins')).toBe(true);
      expect((await pullTables(q, ownerDevice)).tables.has('staff_pins')).toBe(true);
      const rider = await pullTables(q, riderDevice);
      expect(rider.tables.has('staff_pins')).toBe(false);
      expect(rider.tables.has('staff')).toBe(true);
      // staff rows themselves no longer carry hashes
      for (const r of rider.rows.filter((x) => x.table === 'staff')) {
        expect(r.row.pin_hash).toBeNull();
      }
    });
  });
});

interface PushResult {
  accepted: string[];
  errors: { id: string; code: string }[];
}
function pinEntry(staffId: string, actor: string | null, n = 7) {
  const now = new Date(Date.now() + 60_000).toISOString();
  return {
    id: randomUUID(),
    table: 'staff_pins',
    op: 'upsert',
    actor_staff_id: actor,
    row: {
      staff_id: staffId,
      shop_id: f.shopA,
      pin_hash: HASH(n),
      created_at: now,
      updated_at: now,
    },
  };
}
const push = async (q: Query, device: string, entries: unknown[]) =>
  (
    await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
      device,
      JSON.stringify(entries),
    ])
  ).rows[0]!.r;

describe('pushing owner-only tables (write_roles + acting staff)', () => {
  it('accepts a PIN change made by an active owner on a shop device', async () => {
    await asUser(f.ownerA, async (q) => {
      const entry = pinEntry(f.cashierStaffA, f.ownerStaffA);
      expect((await push(q, f.deviceA, [entry])).accepted).toEqual([entry.id]);
    });
  });

  it('refuses it when the acting staff member is a cashier, missing, inactive or of another shop', async () => {
    await asUser(f.ownerA, async (q) => {
      const inactiveOwner = randomUUID();
      await q(
        `insert into staff (id, shop_id, name, role, active) values ($1, $2, 'Old owner', 'owner', false)`,
        [inactiveOwner, f.shopA],
      );
      const entries = [
        pinEntry(f.cashierStaffA, f.cashierStaffA),
        pinEntry(f.cashierStaffA, null),
        pinEntry(f.cashierStaffA, inactiveOwner),
        pinEntry(f.cashierStaffA, f.ownerStaffB),
      ];
      const result = await push(q, f.deviceA, entries);
      expect(result.accepted).toEqual([]);
      expect(result.errors.map((e) => e.code)).toEqual([
        'forbidden',
        'forbidden',
        'forbidden',
        'forbidden',
      ]);
    });
  });

  it('refuses staff edits by a cashier actor too (same rule on staff)', async () => {
    await asUser(f.ownerA, async (q) => {
      const now = new Date().toISOString();
      const entry = {
        id: randomUUID(),
        table: 'staff',
        op: 'upsert',
        actor_staff_id: f.cashierStaffA,
        row: {
          id: randomUUID(),
          shop_id: f.shopA,
          name: 'Sneaky',
          role: 'owner',
          active: true,
          created_at: now,
          updated_at: now,
        },
      };
      expect((await push(q, f.deviceA, [entry])).errors.map((e) => e.code)).toEqual(['forbidden']);
    });
  });

  it('refuses PINs from a rider device (counter_device scope applies to push)', async () => {
    await asUser(f.ownerA, async (q) => {
      const entry = pinEntry(f.cashierStaffA, f.ownerStaffA);
      expect((await push(q, riderDevice, [entry])).errors.map((e) => e.code)).toEqual([
        'forbidden',
      ]);
    });
  });
});
