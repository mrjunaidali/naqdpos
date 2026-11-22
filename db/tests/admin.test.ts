// Admin portal SQL (migration 20261123120000): admin functions, per-session 2FA, 12-hour admin
// sessions, suspension in sync_push, the CLI grant / revoke.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPlatformAdmin } from '../scripts/admin.ts';
import { admin, app, asUser, createFixture, type Fixture, type Query } from './helpers.ts';

let f: Fixture;
let adminUser: string;
const adminEmail = `admin-${randomUUID()}@example.test`;

beforeAll(async () => {
  f = await createFixture();
  adminUser = randomUUID();
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q('select seed_payment_methods($1)', [f.shopA]);
  await q(`insert into users (id, name, email) values ($1, 'Admin', $2)`, [adminUser, adminEmail]);
  await setPlatformAdmin(admin, 'grant', adminEmail);
  await q(
    `update shops set type = 'fruit_veg', city = 'Lahore', name = 'Alpha Fruit' where id = $1`,
    [f.shopA],
  );
  await q(`update shops set type = 'grocery', city = 'Karachi', name = 'Beta Mart' where id = $1`, [
    f.shopB,
  ]);
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
};

describe('admin functions', () => {
  it('refuse everyone who is not a platform admin, including the shop owner', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await fails(q(`select admin_list_shops('{}'::jsonb, 1, 25)`))).toBe('42501');
      expect(await fails(q('select admin_get_shop($1)', [f.shopA]))).toBe('42501');
      expect(await fails(q(`select admin_set_shop_status($1, 'suspended', 'x')`, [f.shopA]))).toBe(
        '42501',
      );
    });
  });

  it('list: search by owner email, filters, paging', async () => {
    await asUser(adminUser, async (q) => {
      const list = async (filters: object, page = 1, size = 25) =>
        (
          await q<{ r: { rows: { id: string }[]; total: number } }>(
            'select admin_list_shops($1::jsonb, $2, $3) as r',
            [JSON.stringify(filters), page, size],
          )
        ).rows[0]!.r;
      const ownerA = (
        await admin.query<{ email: string }>('select email from users where id = $1', [f.ownerA])
      ).rows[0]!.email;
      expect((await list({ q: ownerA })).rows.map((r) => r.id)).toEqual([f.shopA]);
      expect((await list({ q: 'Beta' })).rows.map((r) => r.id)).toEqual([f.shopB]);
      expect((await list({ type: 'fruit_veg', city: 'lahore' })).rows.map((r) => r.id)).toContain(
        f.shopA,
      );
      expect(
        (await list({ type: 'fruit_veg', city: 'lahore' })).rows.map((r) => r.id),
      ).not.toContain(f.shopB);
      const all = await list({}, 1, 1);
      expect(all.rows).toHaveLength(1);
      expect(all.total).toBeGreaterThanOrEqual(2);
      const second = await list({}, 2, 1);
      expect(second.rows[0]!.id).not.toBe(all.rows[0]!.id);
    });
  });

  it('detail: devices and staff without PIN data', async () => {
    await asUser(adminUser, async (q) => {
      const { rows } = await q<{ r: { staff: Record<string, unknown>[]; devices: unknown[] } }>(
        'select admin_get_shop($1) as r',
        [f.shopA],
      );
      expect(rows[0]!.r.devices.length).toBeGreaterThan(0);
      expect(rows[0]!.r.staff.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows[0]!.r)).not.toMatch(/pin_hash/);
    });
  });
});

describe('suspend / reactivate (US011)', () => {
  interface PushResult {
    accepted: string[];
    errors: { id: string; code: string }[];
  }
  const push = async (q: Query, createdAt: string) => {
    const id = randomUUID();
    const r = (
      await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
        f.deviceA,
        JSON.stringify([
          {
            id: randomUUID(),
            table: 'sales',
            op: 'insert',
            actor_staff_id: f.cashierStaffA,
            row: {
              id,
              shop_id: f.shopA,
              receipt_no: `S9-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
              business_date: '2026-11-22',
              staff_id: f.cashierStaffA,
              subtotal_paisa: 100,
              discount_paisa: 0,
              rounding_paisa: 0,
              total_paisa: 100,
              created_at: createdAt,
            },
          },
        ]),
      ])
    ).rows[0]!.r;
    return r.errors.map((e) => e.code);
  };

  it('needs a reason; writes audit_log as admin; refuses rows created after suspended_at; reactivate restores', async () => {
    const client = await admin.connect();
    try {
      await client.query('begin');
      await client.query('set local role naqdpos_app');
      const as = (user: string) =>
        client.query(`select set_config('app.user_id', $1, true)`, [user]);
      const q: Query = async (text, values) => {
        await client.query('savepoint s');
        try {
          const r = await client.query(text, values);
          await client.query('release savepoint s');
          return r;
        } catch (e) {
          await client.query('rollback to savepoint s');
          throw e;
        }
      };
      await as(adminUser);
      expect(await fails(q(`select admin_set_shop_status($1, 'suspended', '  ')`, [f.shopA]))).toBe(
        '22023',
      );
      await q(`select admin_set_shop_status($1, 'suspended', 'unpaid since October')`, [f.shopA]);
      const { rows: audit } = await client.query<{
        acting_as_admin: boolean;
        payload: { reason: string; to: string };
        action: string;
      }>(
        `select acting_as_admin, payload, action from public.admin_get_shop($1) g,
           jsonb_to_recordset(g -> 'audit') as a(acting_as_admin boolean, payload jsonb, action text) limit 1`,
        [f.shopA],
      );
      expect(audit[0]).toMatchObject({
        acting_as_admin: true,
        action: 'shop.suspend',
        payload: { reason: 'unpaid since October', to: 'suspended' },
      });

      await as(f.cashierA);
      expect(await push(q, new Date(Date.now() + 60_000).toISOString())).toEqual([
        'shop_suspended',
      ]);
      expect(await push(q, new Date(Date.now() - 3_600_000).toISOString())).toEqual([]); // made before

      await as(adminUser);
      await q(`select admin_set_shop_status($1, 'active', 'paid')`, [f.shopA]);
      // Admins read shops only through admin functions (tenant RLS does not let them in).
      expect((await q('select 1 from shops where id = $1', [f.shopA])).rowCount).toBe(0);
      const { rows: shop } = await q<{ s: { status: string; suspended_at: string | null } }>(
        `select admin_get_shop($1) -> 'shop' as s`,
        [f.shopA],
      );
      expect(shop[0]!.s).toMatchObject({ status: 'active', suspended_at: null });
      await as(f.cashierA);
      expect(await push(q, new Date().toISOString())).toEqual([]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('admin sessions', () => {
  it('2FA per session, 12 hours at most, removed with the session', async () => {
    const session = randomUUID();
    const old = randomUUID();
    await admin.query(
      `insert into sessions (id, user_id, token, expires_at, created_at) values
         ($1::uuid, $3, $1::text, now() + interval '90 days', now()),
         ($2::uuid, $3, $2::text, now() + interval '90 days', now() - interval '13 hours')`,
      [session, old, adminUser],
    );
    await asUser(adminUser, async (q) => {
      const state = async (id: string) =>
        (await q<{ s: string }>('select admin_session_ok($1) as s', [id])).rows[0]!.s;
      expect(await state(session)).toBe('two_factor_setup');
      await admin.query('update users set two_factor_enabled = true where id = $1', [adminUser]);
      expect(await state(session)).toBe('two_factor_required');
      await q('select admin_mark_session_verified($1)', [session]);
      expect(await state(session)).toBe('ok');
      expect(await state(old)).toBe('session_expired');
    });
    await asUser(f.ownerA, async (q) => {
      expect(
        (await q<{ s: string }>('select admin_session_ok($1) as s', [session])).rows[0]!.s,
      ).toBe('no_session');
      expect(await fails(q('select admin_mark_session_verified($1)', [session]))).toBe('42501');
      expect(await fails(q('select * from admin_session_2fa'))).toBe('42501');
    });
    await admin.query('delete from sessions where id = $1', [session]);
    const { rows } = await admin.query('select 1 from admin_session_2fa where session_id = $1', [
      session,
    ]);
    expect(rows).toHaveLength(0);
    await admin.query('update users set two_factor_enabled = false where id = $1', [adminUser]);
  });
});

describe('CLI grant / revoke', () => {
  it('grants and revokes, audit-logged; unknown emails refused; not callable by the app role', async () => {
    const user = randomUUID();
    const email = `new-${user}@example.test`;
    await admin.query(`insert into users (id, name, email) values ($1, 'New', $2)`, [user, email]);
    await setPlatformAdmin(admin, 'grant', email.toUpperCase());
    expect(
      (await admin.query('select 1 from platform_admins where user_id = $1', [user])).rowCount,
    ).toBe(1);
    await setPlatformAdmin(admin, 'revoke', email);
    expect(
      (await admin.query('select 1 from platform_admins where user_id = $1', [user])).rowCount,
    ).toBe(0);
    const { rows } = await admin.query<{ action: string }>(
      `select action from audit_log where entity_id = $1 order by at`,
      [user],
    );
    expect(rows.map((r) => r.action)).toEqual(['admin.grant', 'admin.revoke']);
    expect(await fails(setPlatformAdmin(admin, 'grant', 'nobody@example.test'))).toBe('P0002');
    await asUser(adminUser, async (q) => {
      expect(await fails(q(`select admin_grant($1)`, [email]))).toBe('42501');
    });
  });

  it('owners can set the shop city', async () => {
    await asUser(f.ownerA, async (q) => {
      const r = await q(`update shops set city = 'Multan' where id = $1`, [f.shopA]);
      expect(r.rowCount).toBe(1);
    });
  });
});
