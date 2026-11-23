// Invites and the admin acting as a shop (migration 20261123150000, US012 / US013).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPlatformAdmin } from '../scripts/admin.ts';
import { admin, app, asUser, createFixture, type Fixture } from './helpers.ts';

let f: Fixture;
let adminUser: string;
const HASH = 'pbkdf2-sha256$1000$c2FsdA==$aGFzaA==';

/** Runs one statement as a user and COMMITS (devices then pull what was written). */
async function committed<R extends Record<string, unknown>>(
  userId: string,
  text: string,
  values: unknown[] = [],
) {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const result = await client.query<R>(text, values);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
};
async function newUser(email: string, verified = true) {
  const id = randomUUID();
  await admin.query('insert into users (id, name, email, email_verified) values ($1, $2, $3, $4)', [
    id,
    'Someone',
    email,
    verified,
  ]);
  return id;
}
async function createShop(email: string, name = 'New Fruit') {
  const [row] = await committed<{
    r: { shop_id: string; owner_staff_id: string; invite_id: string };
  }>(adminUser, 'select admin_create_shop($1::jsonb) as r', [
    JSON.stringify({
      name,
      type: 'fruit_veg',
      city: 'Lahore',
      owner_name: 'Bilal',
      owner_mobile: '+923001234567',
      owner_email: email,
    }),
  ]);
  return row!.r;
}

beforeAll(async () => {
  f = await createFixture();
  const email = `admin-${randomUUID()}@example.test`;
  adminUser = await newUser(email);
  await setPlatformAdmin(admin, 'grant', email);
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('admin_create_shop and invites', () => {
  it('creates the shop, the owner staff row without a PIN, seeds and a pending invite; audited', async () => {
    const email = `Owner-${randomUUID()}@Example.test`;
    const r = await createShop(email);
    const staff = (
      await admin.query<Record<string, unknown>>('select * from staff where id = $1', [
        r.owner_staff_id,
      ])
    ).rows[0];
    expect(staff).toMatchObject({ role: 'owner', membership_user_id: null, shop_id: r.shop_id });
    const pins = await admin.query('select 1 from staff_pins where staff_id = $1', [
      r.owner_staff_id,
    ]);
    expect(pins.rowCount).toBe(0);
    const pm = await admin.query<{ n: number }>(
      'select count(*)::int n from payment_methods where shop_id = $1',
      [r.shop_id],
    );
    expect(pm.rows[0]!.n).toBeGreaterThan(0);
    const ec = await admin.query<{ n: number }>(
      'select count(*)::int n from expense_categories where shop_id = $1',
      [r.shop_id],
    );
    expect(ec.rows[0]!.n).toBeGreaterThan(0);
    const inv = (
      await admin.query<{ email: string; expires_at: Date; created_at: Date }>(
        'select * from invites where id = $1',
        [r.invite_id],
      )
    ).rows[0]!;
    expect(inv.email).toBe(email.toLowerCase());
    expect(inv.expires_at.getTime() - inv.created_at.getTime()).toBe(14 * 86_400_000);
    const audit = await admin.query<{ action: string }>(
      `select action from audit_log where shop_id = $1 and acting_as_admin and actor_user_id = $2 order by at`,
      [r.shop_id, adminUser],
    );
    expect(audit.rows.map((a) => a.action)).toEqual(['shop.create', 'invite.create']);
  });

  it('the invited, verified email accepts: membership, staff link, accepted, audit; others get nothing', async () => {
    const email = `owner-${randomUUID()}@example.test`;
    const r = await createShop(email);
    const other = await newUser(`other-${randomUUID()}@example.test`);
    expect((await committed<{ n: number }>(other, 'select accept_invites() n'))[0]!.n).toBe(0);
    const unverified = await newUser(`x-${randomUUID()}@example.test`, false);
    await admin
      .query('update users set email = $1 where id = $2', [email.toUpperCase(), unverified])
      .catch(() => null);
    expect((await committed<{ n: number }>(unverified, 'select accept_invites() n'))[0]!.n).toBe(0);

    const owner = await newUser(email);
    expect((await committed<{ n: number }>(owner, 'select accept_invites() n'))[0]!.n).toBe(1);
    const m = await admin.query<{ role: string }>(
      'select role from memberships where shop_id = $1 and user_id = $2',
      [r.shop_id, owner],
    );
    expect(m.rows[0]!.role).toBe('owner');
    const s = await admin.query<{ membership_user_id: string | null }>(
      'select membership_user_id from staff where id = $1',
      [r.owner_staff_id],
    );
    expect(s.rows[0]!.membership_user_id).toBe(owner);
    const inv = (
      await admin.query<{ accepted_user_id: string | null }>(
        'select * from invites where id = $1',
        [r.invite_id],
      )
    ).rows[0]!;
    expect(inv.accepted_user_id).toBe(owner);
    const a = await admin.query(
      `select 1 from audit_log where shop_id = $1 and action = 'invite.accept'`,
      [r.shop_id],
    );
    expect(a.rowCount).toBe(1);
    // Accepting again does nothing.
    expect((await committed<{ n: number }>(owner, 'select accept_invites() n'))[0]!.n).toBe(0);
  });

  it('expired and revoked invites are ignored; one pending per shop and email', async () => {
    const email = `late-${randomUUID()}@example.test`;
    const r = await createShop(email);
    await admin.query(`update invites set expires_at = now() - interval '1 minute' where id = $1`, [
      r.invite_id,
    ]);
    const u = await newUser(email);
    expect((await committed<{ n: number }>(u, 'select accept_invites() n'))[0]!.n).toBe(0);

    const email2 = `rev-${randomUUID()}@example.test`;
    const r2 = await createShop(email2);
    await committed(adminUser, 'select admin_revoke_invite($1)', [r2.invite_id]);
    const u2 = await newUser(email2);
    expect((await committed<{ n: number }>(u2, 'select accept_invites() n'))[0]!.n).toBe(0);

    // A second invite replaces the pending one; a raw second pending row is refused.
    const email3 = `dup-${randomUUID()}@example.test`;
    const r3 = await createShop(email3);
    await committed(adminUser, 'select admin_create_invite($1, $2)', [r3.shop_id, email3]);
    const pending = await admin.query<{ n: number }>(
      'select count(*)::int n from invites where shop_id = $1 and accepted_at is null and revoked_at is null',
      [r3.shop_id],
    );
    expect(pending.rows[0]!.n).toBe(1);
    expect(
      await fails(
        admin.query('insert into invites (shop_id, email, staff_id) values ($1, $2, $3)', [
          r3.shop_id,
          email3,
          r3.owner_staff_id,
        ]),
      ),
    ).toBe('23505');
  });

  it('a new invite: allowed while the owner row is unlinked (pending, expired, revoked), refused once joined', async () => {
    const email = `again-${randomUUID()}@example.test`;
    const r = await createShop(email);
    const invite = (to: string) =>
      committed<{ id: string }>(adminUser, 'select admin_create_invite($1, $2) id', [
        r.shop_id,
        to,
      ]);
    await invite(email); // pending → replaced
    await admin.query(
      `update invites set expires_at = now() - interval '1 minute' where shop_id = $1`,
      [r.shop_id],
    );
    const [fresh] = await invite(email); // expired → new
    await committed(adminUser, 'select admin_revoke_invite($1)', [fresh!.id]);
    await invite(`fixed-${email}`); // revoked → new (corrected email)

    const owner = await newUser(`fixed-${email}`);
    await committed(owner, 'select accept_invites()');
    const before = await admin.query<{ n: number }>(
      'select count(*)::int n from invites where shop_id = $1',
      [r.shop_id],
    );
    expect(await fails(invite(`second-${email}`))).toBe('NQ001');
    expect(await fails(invite(`fixed-${email}`))).toBe('NQ001');
    const after = await admin.query<{ n: number }>(
      'select count(*)::int n from invites where shop_id = $1',
      [r.shop_id],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    // A self-registered shop's owner is linked from the start.
    expect(
      await fails(
        committed(adminUser, 'select admin_create_invite($1, $2)', [f.shopA, 'x@example.test']),
      ),
    ).toBe('NQ001');
  });

  it('an existing owner accepts a second invite and owns both shops', async () => {
    const email = `two-${randomUUID()}@example.test`;
    const first = await createShop(email, 'First');
    const owner = await newUser(email);
    await committed(owner, 'select accept_invites()');
    const second = await createShop(email, 'Second');
    expect((await committed<{ n: number }>(owner, 'select accept_invites() n'))[0]!.n).toBe(1);
    const shops = await admin.query<{ shop_id: string }>(
      'select shop_id from memberships where user_id = $1',
      [owner],
    );
    expect(shops.rows.map((x) => x.shop_id).sort()).toEqual([first.shop_id, second.shop_id].sort());
  });
});

describe('first PIN', () => {
  it('only the linked owner, only when no PIN exists; audited', async () => {
    const email = `pin-${randomUUID()}@example.test`;
    const r = await createShop(email);
    const owner = await newUser(email);
    expect(
      await fails(committed(owner, 'select owner_set_first_pin($1, $2)', [r.owner_staff_id, HASH])),
    ).toBe('42501');
    await committed(owner, 'select accept_invites()');
    expect(
      await fails(
        committed(adminUser, 'select owner_set_first_pin($1, $2)', [r.owner_staff_id, HASH]),
      ),
    ).toBe('42501');
    expect(
      await fails(
        committed(f.ownerA, 'select owner_set_first_pin($1, $2)', [r.owner_staff_id, HASH]),
      ),
    ).toBe('42501');
    await committed(owner, 'select owner_set_first_pin($1, $2)', [r.owner_staff_id, HASH]);
    expect(
      await fails(committed(owner, 'select owner_set_first_pin($1, $2)', [r.owner_staff_id, HASH])),
    ).toBe('23505');
    const a = await admin.query(
      `select acting_as_admin from audit_log where shop_id = $1 and action = 'staff.first_pin'`,
      [r.shop_id],
    );
    expect(a.rows).toEqual([{ acting_as_admin: false }]);
  });
});

describe('admin acting as a shop', () => {
  it('every admin function refuses non-admins and owners', async () => {
    await asUser(f.ownerA, async (q) => {
      const p = JSON.stringify({ name: 'X', unit: 'kg', sale_price_paisa: 0 });
      for (const [text, values] of [
        ['select admin_create_shop($1::jsonb)', [JSON.stringify({ name: 'X', type: 'grocery' })]],
        ['select admin_create_invite($1, $2)', [f.shopA, 'a@b.c']],
        ['select admin_revoke_invite($1)', [randomUUID()]],
        ['select admin_save_product($1, $2::jsonb)', [f.shopA, p]],
        ['select admin_hide_product($1, $2, true)', [f.shopA, randomUUID()]],
        ['select admin_import_products($1, $2::jsonb, $3)', [f.shopA, `[${p}]`, 'skip']],
        ['select admin_save_category($1, $2::jsonb)', [f.shopA, '{"name":"C"}']],
        [
          'select admin_save_staff($1, $2::jsonb, null)',
          [f.shopA, '{"name":"C","role":"cashier"}'],
        ],
        ['select admin_shop_catalogue($1)', [f.shopA]],
      ] as const) {
        expect(await fails(q(text, [...values])), text).toBe('42501');
      }
    });
  });

  it('products, categories and staff are written as normal rows, audited, and pulled by the shop device', async () => {
    const before = (
      await admin.query<{ s: string }>('select coalesce(max(server_seq), 0) s from products')
    ).rows[0]!.s;
    const [cat] = await committed<{ id: string }>(
      adminUser,
      'select admin_save_category($1, $2::jsonb) id',
      [f.shopA, JSON.stringify({ name: 'Fruits', name_ur: 'پھل' })],
    );
    const [prod] = await committed<{ id: string }>(
      adminUser,
      'select admin_save_product($1, $2::jsonb) id',
      [
        f.shopA,
        JSON.stringify({
          name: 'Mango',
          unit: 'kg',
          category_id: cat!.id,
          sale_price_paisa: 30000,
          cost_price_paisa: 22000,
          search_terms: ['aam'],
        }),
      ],
    );
    const [cashier] = await committed<{ id: string }>(
      adminUser,
      'select admin_save_staff($1, $2::jsonb, $3) id',
      [f.shopA, JSON.stringify({ name: 'Asif', role: 'cashier' }), HASH],
    );
    // UUIDv7 ids, device_id null (written by an admin).
    const p = (
      await admin.query<{ id: string; device_id: string | null; server_seq: string }>(
        'select * from products where id = $1',
        [prod!.id],
      )
    ).rows[0]!;
    expect(p.id[14]).toBe('7');
    expect(p.device_id).toBeNull();
    expect(Number(p.server_seq)).toBeGreaterThan(Number(before));
    const ph = await admin.query<{ sale_price_paisa: string }>(
      'select sale_price_paisa from price_history where product_id = $1',
      [prod!.id],
    );
    expect(ph.rows.map((x) => Number(x.sale_price_paisa))).toEqual([30000]);

    const audit = await admin.query<{ action: string; payload: { pin: string | null } }>(
      `select action, payload from audit_log where shop_id = $1 and acting_as_admin and actor_user_id = $2 and entity_id = any($3::uuid[])`,
      [f.shopA, adminUser, [cat!.id, prod!.id, cashier!.id]],
    );
    expect(audit.rows.map((a) => a.action).sort()).toEqual([
      'category.save',
      'product.save',
      'staff.save',
    ]);
    expect(audit.rows.find((a) => a.action === 'staff.save')?.payload.pin).toBe('set by admin');
    expect(JSON.stringify(audit.rows)).not.toContain('22000');

    const pulled = await asUser(f.ownerA, async (q) => {
      const { rows } = await q<{
        r: {
          rows: { table: string; row: { id?: string; staff_id?: string; product_id?: string } }[];
        };
      }>('select sync_pull($1, $2, 5000) as r', [f.deviceA, 0]);
      return rows[0]!.r.rows;
    });
    const has = (table: string, id: string) =>
      pulled.some(
        (x) => x.table === table && (x.row.id ?? x.row.staff_id ?? x.row.product_id) === id,
      );
    expect(has('categories', cat!.id)).toBe(true);
    expect(has('products', prod!.id)).toBe(true);
    // deviceA is a shop counter: cost prices stay on owner devices only (architecture §5).
    expect(has('product_costs', prod!.id)).toBe(false);
    const cost = await admin.query<{ cost_price_paisa: string }>(
      'select cost_price_paisa from product_costs where product_id = $1',
      [prod!.id],
    );
    expect(Number(cost.rows[0]!.cost_price_paisa)).toBe(22000);
    expect(has('staff', cashier!.id)).toBe(true);
    expect(has('staff_pins', cashier!.id)).toBe(true);

    // An admin edit keeps the owner's stock tracking (it isn't on the admin form).
    await admin.query('update products set track_stock = true where id = $1', [prod!.id]);
    await committed(adminUser, 'select admin_save_product($1, $2::jsonb)', [
      f.shopA,
      JSON.stringify({
        id: prod!.id,
        name: 'Mango (Sindhri)',
        unit: 'kg',
        sale_price_paisa: 32000,
      }),
    ]);
    const edited = await admin.query('select name, track_stock from products where id = $1', [
      prod!.id,
    ]);
    expect(edited.rows[0]).toEqual({ name: 'Mango (Sindhri)', track_stock: true });

    // The admin's catalogue view: staff with phone and has_pin, never the hash.
    const [catalogue] = await committed<{ r: { staff: { id: string; has_pin: boolean }[] } }>(
      adminUser,
      'select admin_shop_catalogue($1) as r',
      [f.shopA],
    );
    expect(catalogue!.r.staff.find((s) => s.id === cashier!.id)?.has_pin).toBe(true);
    expect(JSON.stringify(catalogue!.r)).not.toContain('pbkdf2');

    await committed(adminUser, 'select admin_hide_product($1, $2, true)', [f.shopA, prod!.id]);
    const hidden = await admin.query<{ deleted_at: Date | null }>(
      'select deleted_at from products where id = $1',
      [prod!.id],
    );
    expect(hidden.rows[0]!.deleted_at).not.toBeNull();
  });

  it('an owner cannot be added through staff; riders get no PIN here', async () => {
    expect(
      await fails(
        committed(adminUser, 'select admin_save_staff($1, $2::jsonb, null)', [
          f.shopA,
          '{"name":"O","role":"owner"}',
        ]),
      ),
    ).toBe('42501');
    expect(
      await fails(
        committed(adminUser, 'select admin_save_staff($1, $2::jsonb, null)', [
          f.shopA,
          JSON.stringify({ id: f.ownerStaffA, name: 'O', role: 'cashier' }),
        ]),
      ),
    ).toBe('42501');
    expect(
      await fails(
        committed(adminUser, 'select admin_save_staff($1, $2::jsonb, $3)', [
          f.shopA,
          '{"name":"R","role":"rider"}',
          HASH,
        ]),
      ),
    ).toBe('22023');
  });

  it('import: categories on demand, existing names skipped or updated, presets without duplicates', async () => {
    const shop = (await createShop(`imp-${randomUUID()}@example.test`, 'Import Shop')).shop_id;
    const rows = [
      {
        name: 'Tomato',
        name_ur: null,
        unit: 'kg',
        category: 'Vegetables',
        sale_price_paisa: 16000,
        search_terms: [],
      },
      {
        name: 'Onion',
        name_ur: null,
        unit: 'kg',
        category: 'vegetables',
        sale_price_paisa: 9000,
        search_terms: [],
      },
    ];
    const imp = async (r: object[], mode: string) =>
      (
        await committed<{ r: { created: number; updated: number; skipped: number } }>(
          adminUser,
          'select admin_import_products($1, $2::jsonb, $3) r',
          [shop, JSON.stringify(r), mode],
        )
      )[0]!.r;
    expect(await imp(rows, 'skip')).toEqual({ created: 2, updated: 0, skipped: 0 });
    const cats = await admin.query<{ name: string }>(
      'select name from categories where shop_id = $1',
      [shop],
    );
    expect(cats.rows.map((c) => c.name)).toEqual(['Vegetables']);
    // The same preset list again: nothing duplicated.
    expect(await imp(rows, 'skip')).toEqual({ created: 0, updated: 0, skipped: 2 });
    expect(await imp([{ ...rows[0], name: 'TOMATO', sale_price_paisa: 17000 }], 'update')).toEqual({
      created: 0,
      updated: 1,
      skipped: 0,
    });
    const t = await admin.query(
      `select count(*)::int n, max(sale_price_paisa)::int p from products where shop_id = $1 and lower(name) = 'tomato'`,
      [shop],
    );
    expect(t.rows[0]).toEqual({ n: 1, p: 17000 });
    expect(await fails(imp(rows, 'merge'))).toBe('22023');
  });
});
