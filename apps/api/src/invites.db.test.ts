// Invited owner end to end against naqdpos_test (run by `pnpm db:test`, US012): an admin creates
// the shop, the owner signs in with the invited email (email code), /me accepts the invite, the
// owner sets the first PIN once; another email sees nothing; admin routes refuse the owner.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb } from './db/index.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
});
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
const authPool = createAuthPool(env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_ADMIN_URL!);
adminUrl.pathname = '/naqdpos_test';
const owner = new pg.Pool({ connectionString: adminUrl.toString() });
const otps = new Map<string, string>();
const auth = createAuth(env, {
  pool: authPool,
  logger,
  sendOtp: (email, otp) => {
    otps.set(email, otp);
    return Promise.resolve();
  },
});
const app = createApp({
  db,
  auth,
  logger,
  origins: env.APP_ORIGINS,
  checkDb: () => Promise.resolve(true),
});

afterAll(async () => {
  await Promise.all([db.destroy(), authPool.end(), owner.end()]);
});

const jsonHeaders = { 'content-type': 'application/json' };
const bearer = (token: string) => ({ ...jsonHeaders, authorization: `Bearer ${token}` });
const HASH = 'pbkdf2-sha256$1000$c2FsdA==$aGFzaA==';

async function signIn(email: string) {
  await app.request('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const res = await app.request('/auth/sign-in/email-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, otp: otps.get(email) }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function adminCreatesShop(ownerEmail: string) {
  const adminId = randomUUID();
  await owner.query(
    'insert into users (id, name, email, email_verified) values ($1, $2, $3, true)',
    [adminId, 'Admin', `a-${adminId}@example.test`],
  );
  await owner.query('insert into platform_admins (user_id) values ($1)', [adminId]);
  const client = await owner.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true)`, [adminId]);
    const { rows } = await client.query<{ r: { shop_id: string; owner_staff_id: string } }>(
      'select admin_create_shop($1::jsonb) as r',
      [
        JSON.stringify({
          name: 'Invited Fruit',
          type: 'fruit_veg',
          owner_name: 'Bilal',
          owner_mobile: '+923001234567',
          owner_email: ownerEmail,
        }),
      ],
    );
    await client.query('commit');
    return rows[0]!.r;
  } finally {
    client.release();
  }
}

type Me = {
  shops: { role: string; shop: { id: string }; staff: { id: string } | null; has_pin?: boolean }[];
};
const me = async (token: string) =>
  (await (await app.request('/me', { headers: bearer(token) })).json()) as Me;
const firstPin = (token: string, staffId: string) =>
  app.request(`/staff/${staffId}/first-pin`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ pin_hash: HASH }),
  });

describe('invited owner', () => {
  it('signs in with the invited email, becomes owner, sets the first PIN once', async () => {
    const email = `invited-${randomUUID()}@example.test`;
    const shop = await adminCreatesShop(email);

    const stranger = await signIn(`stranger-${randomUUID()}@example.test`);
    expect((await me(stranger)).shops).toEqual([]);
    expect((await firstPin(stranger, shop.owner_staff_id)).status).toBe(403);

    const token = await signIn(email);
    const first = await me(token);
    expect(first.shops).toHaveLength(1);
    expect(first.shops[0]).toMatchObject({
      role: 'owner',
      shop: { id: shop.shop_id },
      staff: { id: shop.owner_staff_id },
      has_pin: false,
    });

    expect((await firstPin(token, shop.owner_staff_id)).status).toBe(200);
    expect((await me(token)).shops[0]!.has_pin).toBe(true);
    expect((await firstPin(token, shop.owner_staff_id)).status).toBe(409);

    // A normal owner cannot use the admin routes.
    const res = await app.request('/admin/shops', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('a new invite is refused once the owner has joined (409 owner_joined), allowed before', async () => {
    // A verified admin session: admin, 2FA on, this session passed TOTP (Step 21 rules).
    const adminEmail = `admin-${randomUUID()}@example.test`;
    const adminToken = await signIn(adminEmail);
    const { rows } = await owner.query<{ user_id: string; session_id: string }>(
      `select u.id user_id, s.id session_id from users u join sessions s on s.user_id = u.id
       where u.email = $1`,
      [adminEmail],
    );
    const { user_id, session_id } = rows[0]!;
    await owner.query('insert into platform_admins (user_id) values ($1)', [user_id]);
    await owner.query('update users set two_factor_enabled = true where id = $1', [user_id]);
    await owner.query('insert into admin_session_2fa (session_id) values ($1)', [session_id]);
    const invite = (shopId: string, email: string) =>
      app.request(`/admin/shops/${shopId}/invites`, {
        method: 'POST',
        headers: bearer(adminToken),
        body: JSON.stringify({ email }),
      });

    const email = `joins-${randomUUID()}@example.test`;
    const shop = await adminCreatesShop(email);
    // Not joined yet: a new invite (e.g. a corrected email) is fine.
    expect((await invite(shop.shop_id, email)).status).toBe(200);

    await me(await signIn(email)); // accepts the invite
    const refused = await invite(shop.shop_id, `second-${randomUUID()}@example.test`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: 'owner_joined',
      message: "The owner has already joined this shop. Adding a second owner isn't supported yet.",
    });
  });
});
