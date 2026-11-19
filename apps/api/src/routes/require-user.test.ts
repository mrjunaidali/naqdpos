import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../app.ts';
import type { AuthService } from '../auth.ts';
import { requireUser } from './require-user.ts';

const USER = { id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0d', email: 'ali@shop.pk', name: '' };
const DEVICE = '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0e';

const auth: AuthService = {
  googleEnabled: false,
  handler: () => Promise.resolve(new Response()),
  handleOAuthCallback: () => Promise.resolve(new Response()),
  getUser: (h) => Promise.resolve(h.get('authorization') === 'Bearer good' ? USER : null),
  createOneTimeToken: () => Promise.resolve('ott'),
};

// The route echoes the transaction context withUserTx would receive.
const app = new Hono<AppEnv>()
  .use('*', requireUser(auth))
  .get('/ctx', (c) => c.json({ tx: c.get('tx'), user: c.get('user') }));

describe('requireUser', () => {
  it('passes X-Device-Id into the transaction context (app.device_id)', async () => {
    const res = await app.request('/ctx', {
      headers: { authorization: 'Bearer good', 'x-device-id': DEVICE },
    });
    expect(await res.json()).toEqual({ tx: { userId: USER.id, deviceId: DEVICE }, user: USER });
  });

  it('uses no device when the header is absent', async () => {
    const res = await app.request('/ctx', { headers: { authorization: 'Bearer good' } });
    expect(await res.json()).toMatchObject({ tx: { userId: USER.id, deviceId: null } });
  });

  it('rejects a malformed device id before checking the session', async () => {
    const res = await app.request('/ctx', { headers: { 'x-device-id': "x'; drop table" } });
    expect(res.status).toBe(400);
  });

  it('returns 401 without a valid session', async () => {
    expect((await app.request('/ctx')).status).toBe(401);
  });
});
