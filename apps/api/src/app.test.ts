import { createApiClient, type FetchLike } from '@naqdpos/core';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app.ts';
import type { AuthService } from './auth.ts';
import type { Db } from './db/index.ts';
import { createLogger } from './logger.ts';
import { memoryStore } from './testing/memoryStore.ts';

const USER = { id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0d', email: 'ali@shop.pk', name: '' };

function stubAuth(overrides: Partial<AuthService> = {}): AuthService {
  return {
    googleEnabled: false,
    handler: () => Promise.resolve(new Response('auth')),
    handleOAuthCallback: () => Promise.resolve(new Response('callback')),
    getUser: (headers) =>
      Promise.resolve(headers.get('authorization') === 'Bearer good' ? USER : null),
    createOneTimeToken: () => Promise.resolve('ott'),
    getSessionInfo: () => Promise.resolve(null),
    enrollTwoFactor: () => Promise.resolve({ totpURI: '', backupCodes: [] }),
    verifyTotp: () => Promise.resolve({ ok: false }),
    verifyBackupCode: () => Promise.resolve(false),
    sendPinResetCode: () => Promise.resolve(),
    verifyPinResetCode: () => Promise.resolve('invalid' as const),
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
  it('reports whether Google sign-in and file storage are on', async () => {
    expect(await (await app().request('/config')).json()).toEqual({ google: false, files: false });
    const on = app({ auth: stubAuth({ googleEnabled: true }), files: memoryStore() });
    expect(await (await on.request('/config')).json()).toEqual({ google: true, files: true });
  });

  it('/files is off without storage (404 files_disabled) and needs a session', async () => {
    const res = await app().request('/files/download-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
      body: JSON.stringify({ key: 'x' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'files_disabled' });
    const anonymous = await app({ files: memoryStore() }).request('/files/download-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'x' }),
    });
    expect(anonymous.status).toBe(401);
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

  // Staging 2026-11-27: the POS sent X-App-Language to an API that did not allow it, and the
  // browser failed sign-in and sync with "CORS error". The header list comes from the real
  // shared client (every option set, with a body), so a new client header fails this test until
  // the API allows it.
  it('preflight allows every header the shared client sends, on Hono and Better Auth routes', async () => {
    const sent = vi.fn<FetchLike>(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) }),
    );
    await createApiClient({
      baseUrl: 'https://api.test',
      fetch: sent,
      getToken: () => 'token',
      getDeviceId: () => '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0e',
      appVersion: '1.0.0',
      getLanguage: () => 'ur',
    }).sendSignInCode('ali@shop.pk');
    // accept is a CORS-safelisted header: browsers never preflight it.
    const clientHeaders = Object.keys(sent.mock.calls[0]![1].headers).filter((h) => h !== 'accept');
    expect(clientHeaders).toEqual(
      expect.arrayContaining(['authorization', 'x-device-id', 'x-app-version', 'x-app-language']),
    );
    for (const [path, method] of [
      ['/sync/pull', 'GET'],
      ['/auth/email-otp/send-verification-otp', 'POST'],
    ] as const) {
      const preflight = await app().request(path, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': method,
          'access-control-request-headers': [...clientHeaders, 'content-type'].join(','),
        },
      });
      expect(preflight.status, path).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin'), path).toBe(
        'http://localhost:5173',
      );
      const allowed = (preflight.headers.get('access-control-allow-headers') ?? '')
        .toLowerCase()
        .split(',')
        .map((h) => h.trim());
      for (const header of [...clientHeaders, 'content-type'])
        expect(allowed, `${path}: ${header}`).toContain(header);
    }
  });

  it('serves the OpenAPI document and a JSON 404', async () => {
    const doc = (await (await app().request('/openapi.json')).json()) as { paths: object };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/config',
        '/me',
        '/shops',
        '/devices',
        '/sync/push',
        '/sync/pull',
      ]),
    );
    const missing = await app().request('/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });
});

describe('POST /devices/{id}/mode', () => {
  const path = '/devices/019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0e/mode';
  it('needs a session', async () => {
    const res = await app().request(path, {
      method: 'POST',
      body: JSON.stringify({ mode: 'owner' }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts only owner or shop, and a UUID id', async () => {
    const bad = await app().request(path, {
      method: 'POST',
      headers: signedIn,
      body: JSON.stringify({ mode: 'rider' }),
    });
    expect(bad.status).toBe(400);
    const badId = await app().request('/devices/phone-1/mode', {
      method: 'POST',
      headers: signedIn,
      body: JSON.stringify({ mode: 'owner' }),
    });
    expect(badId.status).toBe(400);
  });
});

describe('/sync/* (architecture §4)', () => {
  const DEVICE = '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0e';
  const pull = (headers: Record<string, string>, deps: Partial<AppDeps> = {}) =>
    app(deps).request(`/sync/pull?device_id=${DEVICE}&since_seq=0`, { headers });
  const pushBody = JSON.stringify({ device_id: DEVICE, entries: [] });

  it.each([
    ['older', '1.3.9', 426],
    ['missing', undefined, 426],
    ['malformed', 'latest', 426],
  ])('answers 426 with min_version when the app version is %s', async (_, version, status) => {
    const headers: Record<string, string> = { ...signedIn, 'x-device-id': DEVICE };
    if (version) headers['x-app-version'] = version;
    const res = await pull(headers, { minAppVersion: '1.4.0' });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: 'upgrade_required', min_version: '1.4.0' });
    const push = await app({ minAppVersion: '1.4.0' }).request('/sync/push', {
      method: 'POST',
      headers,
      body: pushBody,
    });
    expect(push.status).toBe(426);
  });

  it('answers 426 before checking the session', async () => {
    const res = await pull({ 'x-app-version': '0.1.0' }, { minAppVersion: '1.4.0' });
    expect(res.status).toBe(426);
  });

  it('lets equal or newer versions through, and every version while MIN_APP_VERSION is unset', async () => {
    // Past the gate, an unsigned request gets 401: the gate let it through.
    for (const version of ['1.4.0', '1.10.0']) {
      const res = await pull({ 'x-app-version': version }, { minAppVersion: '1.4.0' });
      expect(res.status, version).toBe(401);
    }
    expect((await pull({})).status).toBe(401);
  });

  it('gates only /sync/*', async () => {
    const res = await app({ minAppVersion: '9.0.0' }).request('/health');
    expect(res.status).toBe(200);
  });

  it('rejects a device_id that differs from X-Device-Id', async () => {
    const other = '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0f';
    const res = await app().request('/sync/push', {
      method: 'POST',
      headers: { ...signedIn, 'x-device-id': other },
      body: pushBody,
    });
    expect(res.status).toBe(400);
    const missing = await pull(signedIn);
    expect(missing.status).toBe(400);
  });

  it('rejects more than 200 entries', async () => {
    const entries = Array.from({ length: 201 }, (_, i) => ({
      id: `019a9b8e-1c2d-7e3f-8a4b-${String(i).padStart(12, '0')}`,
      table: 'staff',
      op: 'upsert',
      row: {},
    }));
    const res = await app().request('/sync/push', {
      method: 'POST',
      headers: { ...signedIn, 'x-device-id': DEVICE },
      body: JSON.stringify({ device_id: DEVICE, entries }),
    });
    expect(res.status).toBe(400);
  });

  it('allows the X-App-Version header in CORS', async () => {
    const preflight = await app().request('/sync/pull', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-app-version',
      },
    });
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-app-version',
    );
  });
});

// Staging, 26 Nov 2026: a 500 said only {"error":"internal"}; now the body, the X-Request-Id
// header and the log line share one id.
describe('unexpected errors carry a request id', () => {
  function failing() {
    const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const pgError = Object.assign(new Error('function public.sync_units() does not exist'), {
      code: '42883',
      routine: 'ParseFuncOrColumn',
    });
    const res = app({ logger, checkDb: () => Promise.reject(pgError) });
    return { res, logged };
  }

  it('returns the id in the 500 body and header, and logs it with the Postgres details', async () => {
    const { res, logged } = failing();
    const response = await res.request('/health');
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; request_id: string };
    expect(body.error).toBe('internal');
    expect(body.request_id).toMatch(/\S{8,}/);
    expect(response.headers.get('x-request-id')).toBe(body.request_id);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: body.request_id,
        path: '/health',
        pg: expect.objectContaining({ code: '42883', routine: 'ParseFuncOrColumn' }) as unknown,
      }),
      'unhandled error',
    );
  });

  it('keeps an incoming X-Request-Id (e.g. from the proxy)', async () => {
    const { res } = failing();
    const response = await res.request('/health', { headers: { 'x-request-id': 'edge-123' } });
    expect(((await response.json()) as { request_id: string }).request_id).toBe('edge-123');
  });
});
