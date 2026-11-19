import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  app,
  asUser,
  createFixture,
  errorCode,
  TENANT_TABLES,
  type Fixture,
} from './helpers.ts';

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const RLS_VIOLATION = '42501';

describe('no user set', () => {
  it('sees no rows in any tenant table', async () => {
    await asUser(null, async (q) => {
      for (const table of TENANT_TABLES) {
        const { rowCount } = await q(`select 1 from ${table}`);
        expect(rowCount, table).toBe(0);
      }
    });
  });

  it('cannot insert or update', async () => {
    await asUser(null, async (q) => {
      expect(
        await errorCode(
          q(`insert into staff (id, shop_id, name, role) values ($1, $2, 'X', 'cashier')`, [
            randomUUID(),
            f.shopA,
          ]),
        ),
      ).toBe(RLS_VIOLATION);
      const { rowCount } = await q(`update shops set name = 'Hacked' where id = $1`, [f.shopA]);
      expect(rowCount).toBe(0);
    });
  });

  it('cannot call create_shop', async () => {
    await asUser(null, async (q) => {
      const code = await errorCode(
        q(`select create_shop($1, 'S', 'grocery', $2, 'O', '0300', '0300', 'h')`, [
          randomUUID(),
          randomUUID(),
        ]),
      );
      expect(code).toBe('42501');
    });
  });

  it('a signed-in user with no shop also sees nothing', async () => {
    await asUser(f.outsider, async (q) => {
      for (const table of TENANT_TABLES) {
        const { rowCount } = await q(`select 1 from ${table}`);
        expect(rowCount, table).toBe(0);
      }
    });
  });
});

describe('shop isolation', () => {
  it('shop A owner reads only shop A rows', async () => {
    await asUser(f.ownerA, async (q) => {
      const shops = await q<{ id: string }>('select id from shops');
      expect(shops.rows.map((r) => r.id)).toEqual([f.shopA]);
      for (const table of ['memberships', 'staff', 'staff_salaries', 'devices']) {
        const { rows } = await q<{ shop_id: string }>(`select distinct shop_id from ${table}`);
        expect(
          rows.map((r) => r.shop_id),
          table,
        ).toEqual([f.shopA]);
      }
    });
  });

  it('shop A owner cannot read shop B by id', async () => {
    await asUser(f.ownerA, async (q) => {
      expect((await q('select 1 from shops where id = $1', [f.shopB])).rowCount).toBe(0);
      expect((await q('select 1 from staff where shop_id = $1', [f.shopB])).rowCount).toBe(0);
    });
  });

  it('shop A owner cannot change shop B rows', async () => {
    await asUser(f.ownerA, async (q) => {
      expect((await q(`update shops set name = 'X' where id = $1`, [f.shopB])).rowCount).toBe(0);
      expect((await q(`update staff set name = 'X' where id = $1`, [f.ownerStaffB])).rowCount).toBe(
        0,
      );
    });
    const { rows } = await admin.query<{ name: string }>('select name from shops where id = $1', [
      f.shopB,
    ]);
    expect(rows[0]?.name).toBe('Shop B');
  });

  it('shop A owner cannot insert rows into shop B', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(
        await errorCode(
          q(`insert into staff (id, shop_id, name, role) values ($1, $2, 'X', 'cashier')`, [
            randomUUID(),
            f.shopB,
          ]),
        ),
      ).toBe(RLS_VIOLATION);
      expect(
        await errorCode(
          q(
            `insert into devices (id, shop_id, name, code, registered_by) values ($1, $2, 'D', 'B9', $3)`,
            [randomUUID(), f.shopB, f.ownerA],
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('shop A owner cannot move a row into shop B', async () => {
    await asUser(f.ownerA, async (q) => {
      const code = await errorCode(
        q('update staff set shop_id = $1 where id = $2', [f.shopB, f.cashierStaffA]),
      );
      expect(code).toBe(RLS_VIOLATION);
    });
  });
});

describe('cashier limits', () => {
  it('cashier reads own shop, staff and devices', async () => {
    await asUser(f.cashierA, async (q) => {
      expect((await q('select 1 from shops')).rowCount).toBe(1);
      expect((await q('select 1 from staff')).rowCount).toBe(2);
      expect((await q('select 1 from devices')).rowCount).toBe(1);
    });
  });

  it('cashier cannot change shop settings', async () => {
    await asUser(f.cashierA, async (q) => {
      expect((await q(`update shops set name = 'X' where id = $1`, [f.shopA])).rowCount).toBe(0);
    });
  });

  it('cashier cannot add or change staff', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(
        await errorCode(
          q(`insert into staff (id, shop_id, name, role) values ($1, $2, 'X', 'cashier')`, [
            randomUUID(),
            f.shopA,
          ]),
        ),
      ).toBe(RLS_VIOLATION);
      expect(
        (await q(`update staff set pin_hash = 'x' where id = $1`, [f.cashierStaffA])).rowCount,
      ).toBe(0);
    });
  });

  it('cashier cannot see, add or change staff_salaries', async () => {
    await asUser(f.cashierA, async (q) => {
      expect((await q('select 1 from staff_salaries')).rowCount).toBe(0);
      expect(
        (
          await q('update staff_salaries set monthly_salary_paisa = 1 where staff_id = $1', [
            f.cashierStaffA,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        await errorCode(
          q(
            'insert into staff_salaries (staff_id, shop_id, monthly_salary_paisa) values ($1, $2, 1)',
            [f.ownerStaffA, f.shopA],
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('cashier cannot register devices', async () => {
    await asUser(f.cashierA, async (q) => {
      expect(
        await errorCode(
          q(
            `insert into devices (id, shop_id, name, code, registered_by) values ($1, $2, 'D', 'A2', $3)`,
            [randomUUID(), f.shopA, f.cashierA],
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });
});

describe('owner rights', () => {
  it('owner changes shop settings', async () => {
    await asUser(f.ownerA, async (q) => {
      const { rowCount } = await q(`update shops set name = 'Shop A2' where id = $1`, [f.shopA]);
      expect(rowCount).toBe(1);
    });
  });

  it('owner cannot change admin-only shop columns', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(
        await errorCode(q(`update shops set status = 'suspended' where id = $1`, [f.shopA])),
      ).toBe('42501');
      expect(await errorCode(q(`update shops set plan_id = 'pro' where id = $1`, [f.shopA]))).toBe(
        '42501',
      );
    });
  });

  it('owner adds and changes staff', async () => {
    await asUser(f.ownerA, async (q) => {
      const id = randomUUID();
      await q(`insert into staff (id, shop_id, name, role) values ($1, $2, 'New', 'rider')`, [
        id,
        f.shopA,
      ]);
      const { rowCount } = await q(`update staff set name = 'Renamed' where id = $1`, [id]);
      expect(rowCount).toBe(1);
    });
  });

  it('owner reads, adds and changes staff_salaries', async () => {
    await asUser(f.ownerA, async (q) => {
      expect((await q('select 1 from staff_salaries')).rowCount).toBe(1);
      await q(
        'insert into staff_salaries (staff_id, shop_id, monthly_salary_paisa) values ($1, $2, 5000000)',
        [f.ownerStaffA, f.shopA],
      );
      const { rowCount } = await q(
        'update staff_salaries set monthly_salary_paisa = 3500000 where staff_id = $1',
        [f.cashierStaffA],
      );
      expect(rowCount).toBe(1);
    });
  });

  it('owner registers a device only as themselves', async () => {
    await asUser(f.ownerA, async (q) => {
      await q(
        `insert into devices (id, shop_id, name, code, registered_by) values ($1, $2, 'D', 'A2', $3)`,
        [randomUUID(), f.shopA, f.ownerA],
      );
      expect(
        await errorCode(
          q(
            `insert into devices (id, shop_id, name, code, registered_by) values ($1, $2, 'D', 'A3', $3)`,
            [randomUUID(), f.shopA, f.cashierA],
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('nobody deletes tenant rows (soft delete only)', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q('delete from staff where id = $1', [f.cashierStaffA]))).toBe(
        '42501',
      );
    });
  });
});
