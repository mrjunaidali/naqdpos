// /files/* and invite emails against naqdpos_test (run by `pnpm db:test`; architecture §9, US014,
// US012): logo uploads are owner-only, downloads for members of the key's shop, keys off the
// list are refused, old logos are cleaned up; the owner invite is emailed when SMTP is set.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPin } from '@naqdpos/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createAuth, createAuthPool } from './auth.ts';
import { createDb } from './db/index.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';
import type { Mail, Mailer } from './mailer.ts';
import { memoryStore } from './testing/memoryStore.ts';

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
const ownerPool = new pg.Pool({ connectionString: adminUrl.toString() });
const otps = new Map<string, string>();
const auth = createAuth(env, {
  pool: authPool,
  logger,
  sendOtp: (email, otp) => {
    otps.set(email, otp);
    return Promise.resolve();
  },
});

const store = memoryStore();
const sent: Mail[] = [];
let mailFails = false;
const mailer: Mailer = {
  send: (mail) => {
    if (mailFails) return Promise.reject(new Error('smtp down'));
    sent.push(mail);
    return Promise.resolve();
  },
  verify: () => Promise.resolve(true),
};
const deps = { db, auth, logger, origins: env.APP_ORIGINS, checkDb: () => Promise.resolve(true) };
const app = createApp({ ...deps, files: store, mailer, posUrl: 'https://pos.naqd.pk' });

afterAll(async () => {
  await Promise.all([db.destroy(), authPool.end(), ownerPool.end()]);
});

const jsonHeaders = { 'content-type': 'application/json' };
const bearer = (token: string) => ({ ...jsonHeaders, authorization: `Bearer ${token}` });
const post = (target: ReturnType<typeof createApp>, path: string, token: string, body: unknown) =>
  target.request(path, { method: 'POST', headers: bearer(token), body: JSON.stringify(body) });

async function signIn(email = `u-${randomUUID()}@example.test`) {
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
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id, email };
}

async function ownerWithShop() {
  const user = await signIn();
  const shop = { shop_id: randomUUID(), owner_staff_id: randomUUID() };
  const res = await post(app, '/shops', user.token, {
    ...shop,
    name: 'Logo Fruit',
    type: 'fruit_veg',
    shop_phone: '+923001234567',
    owner_name: 'Ali',
    owner_phone: '+923001234567',
    owner_pin_hash: await hashPin('4821', { iterations: 1000 }),
  });
  expect(res.status).toBe(201);
  return { ...user, ...shop };
}

async function cashierOf(shopId: string) {
  const user = await signIn();
  await ownerPool.query('insert into memberships (shop_id, user_id, role) values ($1, $2, $3)', [
    shopId,
    user.userId,
    'cashier',
  ]);
  return user;
}

let owner: Awaited<ReturnType<typeof ownerWithShop>>;
let cashier: Awaited<ReturnType<typeof signIn>>;
let otherOwner: Awaited<ReturnType<typeof ownerWithShop>>;

beforeAll(async () => {
  owner = await ownerWithShop();
  cashier = await cashierOf(owner.shop_id);
  otherOwner = await ownerWithShop();
});

const KEY = /^logos\/[0-9a-f-]{36}\/logo-[0-9a-f-]{36}\.(webp|png)$/;

describe('/files/upload-url (shop logo)', () => {
  it('owner gets a new key under their shop and a short-lived PUT URL for that content type', async () => {
    const res = await post(app, '/files/upload-url', owner.token, {
      shop_id: owner.shop_id,
      kind: 'logo',
      content_type: 'image/webp',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; url: string; expires_in: number };
    expect(body.key).toMatch(KEY);
    expect(body.key.startsWith(`logos/${owner.shop_id}/`)).toBe(true);
    expect(body.url).toContain('type=image%2Fwebp');
    expect(body.expires_in).toBe(300);
    // Every upload gets its own key.
    const again = (await (
      await post(app, '/files/upload-url', owner.token, {
        shop_id: owner.shop_id,
        kind: 'logo',
        content_type: 'image/png',
      })
    ).json()) as { key: string };
    expect(again.key).not.toBe(body.key);
    expect(again.key.endsWith('.png')).toBe(true);
  });

  it('cashier and another shop owner get 403; bad input 400; no session 401', async () => {
    for (const token of [cashier.token, otherOwner.token]) {
      const res = await post(app, '/files/upload-url', token, {
        shop_id: owner.shop_id,
        kind: 'logo',
        content_type: 'image/webp',
      });
      expect(res.status).toBe(403);
    }
    for (const body of [
      { shop_id: owner.shop_id, kind: 'logo', content_type: 'image/svg+xml' },
      { shop_id: owner.shop_id, kind: 'bill-photo', content_type: 'image/webp' },
      { shop_id: 'not-a-uuid', kind: 'logo', content_type: 'image/webp' },
    ])
      expect((await post(app, '/files/upload-url', owner.token, body)).status).toBe(400);
    const anonymous = await app.request('/files/upload-url', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ shop_id: owner.shop_id, kind: 'logo', content_type: 'image/webp' }),
    });
    expect(anonymous.status).toBe(401);
  });
});

describe('/files/download-url', () => {
  const key = (shopId: string) => `logos/${shopId}/logo-${randomUUID()}.webp`;

  it('members of the shop in the key (owner, cashier) get a URL', async () => {
    for (const token of [owner.token, cashier.token]) {
      const res = await post(app, '/files/download-url', token, { key: key(owner.shop_id) });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { url: string }).url).toContain(`logos/${owner.shop_id}/`);
    }
  });

  it("another shop's key is 403; keys off the list are 400", async () => {
    expect(
      (await post(app, '/files/download-url', otherOwner.token, { key: key(owner.shop_id) }))
        .status,
    ).toBe(403);
    for (const bad of [
      `logos/${owner.shop_id}/../${otherOwner.shop_id}/logo-${randomUUID()}.webp`,
      `backups/daily/2026-11-23.dump.enc`,
      `logos/${owner.shop_id}/logo.webp`,
    ])
      expect((await post(app, '/files/download-url', owner.token, { key: bad })).status).toBe(400);
  });
});

describe('/files/logo/cleanup', () => {
  it('deletes old logos except the saved one and fresh uploads; owner only', async () => {
    const prefix = `logos/${owner.shop_id}/`;
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    const current = `${prefix}logo-${randomUUID()}.webp`;
    const previous = `${prefix}logo-${randomUUID()}.webp`;
    const fresh = `${prefix}logo-${randomUUID()}.webp`; // may still be on its way into logo_path
    const otherShop = `logos/${otherOwner.shop_id}/logo-${randomUUID()}.webp`;
    store.objects.set(current, { body: Buffer.from('new'), lastModified: hoursAgo(2) });
    store.objects.set(previous, { body: Buffer.from('old'), lastModified: hoursAgo(48) });
    store.objects.set(fresh, { body: Buffer.from('in flight'), lastModified: hoursAgo(0) });
    store.objects.set(otherShop, { body: Buffer.from('x'), lastModified: hoursAgo(48) });
    await ownerPool.query('update shops set logo_path = $1 where id = $2', [
      current,
      owner.shop_id,
    ]);

    expect(
      (await post(app, '/files/logo/cleanup', cashier.token, { shop_id: owner.shop_id })).status,
    ).toBe(403);
    expect(store.objects.has(previous)).toBe(true);

    const res = await post(app, '/files/logo/cleanup', owner.token, { shop_id: owner.shop_id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(store.objects.has(previous)).toBe(false);
    expect(store.objects.has(current)).toBe(true);
    expect(store.objects.has(fresh)).toBe(true);
    expect(store.objects.has(otherShop)).toBe(true);
  });
});

describe('owner invite email (US012)', () => {
  async function adminToken() {
    const email = `admin-${randomUUID()}@example.test`;
    const { token } = await signIn(email);
    const { rows } = await ownerPool.query<{ user_id: string; session_id: string }>(
      `select u.id user_id, s.id session_id from users u join sessions s on s.user_id = u.id where u.email = $1`,
      [email],
    );
    const { user_id, session_id } = rows[0]!;
    await ownerPool.query('insert into platform_admins (user_id) values ($1)', [user_id]);
    await ownerPool.query('update users set two_factor_enabled = true where id = $1', [user_id]);
    await ownerPool.query('insert into admin_session_2fa (session_id) values ($1)', [session_id]);
    return token;
  }
  const newShop = (ownerEmail: string) => ({
    name: 'Mailed Fruit',
    type: 'fruit_veg',
    owner_name: 'Bilal',
    owner_mobile: '+923001234567',
    owner_email: ownerEmail,
  });

  it('new shop and a new invite are emailed in the chosen language (default English)', async () => {
    const token = await adminToken();
    sent.length = 0;
    const email = `owner-${randomUUID()}@example.test`;
    const res = await post(app, '/admin/shops', token, newShop(email));
    expect(res.status).toBe(200);
    const shop = (await res.json()) as { shop_id: string; emailed: boolean };
    expect(shop.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.subject).toBe('Your shop Mailed Fruit is ready on NaqdPOS');
    expect(sent[0]!.text).toBe(
      `Assalam o alaikum! Your shop Mailed Fruit is ready on NaqdPOS. Open https://pos.naqd.pk and sign in with ${email}.`,
    );
    expect(sent[0]!.html).toContain('<html lang="en"');

    const again = await post(app, `/admin/shops/${shop.shop_id}/invites`, token, {
      email,
      language: 'ur',
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ emailed: true });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe('آپ کی دکان Mailed Fruit NaqdPOS پر تیار ہے');
    expect(sent[1]!.html).toContain('<html lang="ur" dir="rtl">');

    const urdu = await post(app, '/admin/shops', token, {
      ...newShop(`owner-${randomUUID()}@example.test`),
      language: 'ur',
    });
    expect(urdu.status).toBe(200);
    expect(sent[2]!.text).toMatch(/^السلام علیکم!/);

    const bad = await post(app, `/admin/shops/${shop.shop_id}/invites`, token, {
      email,
      language: 'fr',
    });
    expect(bad.status).toBe(400);
  });

  it('SMTP failing or not configured: the invite is created, emailed: false', async () => {
    const token = await adminToken();
    mailFails = true;
    try {
      const res = await post(app, '/admin/shops', token, newShop(`o-${randomUUID()}@example.test`));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ emailed: false });
    } finally {
      mailFails = false;
    }
    const noSmtp = createApp({ ...deps, files: null, mailer: null });
    const res = await post(
      noSmtp,
      '/admin/shops',
      token,
      newShop(`o-${randomUUID()}@example.test`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ emailed: false });
  });
});
