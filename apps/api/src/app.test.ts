import { describe, expect, it } from 'vitest';
import { createApp, type AppDeps } from './app.ts';
import type { Db } from './db/index.ts';
import { createLogger } from './logger.ts';

function app(overrides: Partial<AppDeps> = {}) {
  return createApp({
    db: {} as Db, // unit tests never reach the database
    auth: {
      handler: () => Promise.resolve(new Response('auth')),
      getUserId: (headers) =>
        Promise.resolve(headers.get('authorization') === 'Bearer good' ? 'user-1' : null),
    },
    logger: createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }),
    origins: ['http://localhost:5173'],
    checkDb: () => Promise.resolve(true),
    ...overrides,
  });
}

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

describe('POST /shops', () => {
  it('needs a session', async () => {
    const res = await app().request('/shops', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects invalid input with 400 before touching the database', async () => {
    const res = await app().request('/shops', {
      method: 'POST',
      headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
      body: JSON.stringify({ shop_id: 'nope', name: '' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_request' });
  });
});

describe('other routes', () => {
  it('passes /auth/* to Better Auth', async () => {
    const res = await app().request('/auth/get-session');
    expect(await res.text()).toBe('auth');
  });

  it('allows only APP_ORIGINS in CORS', async () => {
    const allowed = await app().request('/health', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const other = await app().request('/health', { headers: { origin: 'https://evil.test' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves the OpenAPI document and a JSON 404', async () => {
    const doc = (await (await app().request('/openapi.json')).json()) as { paths: object };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/health', '/shops']));
    const missing = await app().request('/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });
});
