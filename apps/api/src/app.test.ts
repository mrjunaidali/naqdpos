import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app.ts';
import type { AuthService } from './auth.ts';
import type { Db } from './db/index.ts';
import { createLogger } from './logger.ts';

const USER = { id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0d', email: 'ali@shop.pk', name: '' };

function stubAuth(overrides: Partial<AuthService> = {}): AuthService {
  return {
    googleEnabled: false,
    handler: () => Promise.resolve(new Response('auth')),
    handleOAuthCallback: () => Promise.resolve(new Response('callback')),
    getUser: (headers) =>
      Promise.resolve(headers.get('authorization') === 'Bearer good' ? USER : null),
    createOneTimeToken: () => Promise.resolve('ott'),
    ...overrides,
  };
}

function app(overrides: Partial<AppDeps> = {}) {
  return createApp({
    db: {} as Db, // unit tests never reach the database
    auth: stubAuth(),
    logger: createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }),
    origins: ['http://localhost:5173'],
    checkDb: () => Promise.resolve(true),
    ...overrides,
  });
}

const signedIn = { authorization: 'Bearer good', 'content-type': 'application/json' };

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const res = await app().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
  });

  it('returns 503 when the database is down', async () => {
    const res = await app({ checkDb: () => Promise.resolve(false) }).request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: false });
  });
});

describe('GET /config', () => {
  it('reports whether Google sign-in is on', async () => {
    expect(await (await app().request('/config')).json()).toEqual({ google: false });
    const on = app({ auth: stubAuth({ googleEnabled: true }) });
    expect(await (await on.request('/config')).json()).toEqual({ google: true });
  });
});

describe('routes that need a session', () => {
  it.each([
    ['POST', '/shops'],
    ['POST', '/devices'],
    ['GET', '/me'],
  ])('%s %s returns 401 without one', async (method, path) => {
    const res = await app().request(path, {
      method,
      ...(method === 'POST' && { body: '{}' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects invalid input with 400 before touching the database', async () => {
    for (const path of ['/shops', '/devices']) {
      const res = await app().request(path, {
        method: 'POST',
        headers: signedIn,
        body: JSON.stringify({ shop_id: 'nope', name: '' }),
      });
      expect(res.status, path).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'bad_request' });
    }
  });

  it('rejects an X-Device-Id that is not a UUID', async () => {
    const res = await app().request('/me', {
      headers: { ...signedIn, 'x-device-id': 'phone-1' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a shop whose owner mobile is not in +92 form', async () => {
    const res = await app().request('/shops', {
      method: 'POST',
      headers: signedIn,
      body: JSON.stringify({
        shop_id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
        name: 'Ali Fruit',
        type: 'fruit_veg',
        shop_phone: '03001234567',
        owner_staff_id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0c',
        owner_name: 'Ali',
        owner_phone: '03001234567',
        owner_pin_hash: 'pbkdf2-sha256$100000$c2FsdA==$aGFzaA==',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('owner_phone');
  });
});

describe('auth routes', () => {
  it('passes /auth/* to Better Auth', async () => {
    const res = await app().request('/auth/get-session');
    expect(await res.text()).toBe('auth');
  });

  it('sends the OAuth callback through handleOAuthCallback', async () => {
    const handleOAuthCallback = vi.fn(() => Promise.resolve(new Response('callback')));
    const res = await app({ auth: stubAuth({ handleOAuthCallback }) }).request(
      '/auth/callback/google?code=x&state=y',
    );
    expect(await res.text()).toBe('callback');
    expect(handleOAuthCallback).toHaveBeenCalledOnce();
  });
});

describe('other routes', () => {
  it('allows only APP_ORIGINS in CORS, including the X-Device-Id header', async () => {
    const preflight = await app().request('/me', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,x-device-id',
      },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-device-id',
    );
    const other = await app().request('/health', { headers: { origin: 'https://evil.test' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves the OpenAPI document and a JSON 404', async () => {
    const doc = (await (await app().request('/openapi.json')).json()) as { paths: object };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/health', '/config', '/me', '/shops', '/devices']),
    );
    const missing = await app().request('/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });
});
