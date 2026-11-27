import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type FetchLike } from './client.ts';
import type { CreateShopRequest } from './schemas.ts';

function fakeFetch(status: number, body: unknown) {
  return vi.fn<FetchLike>(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

const SHOP_ID = '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const USER_ID = '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0d';
const DEVICE_ID = '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0e';

const shop: CreateShopRequest = {
  shop_id: SHOP_ID,
  name: '  Ali Fruit  ',
  type: 'fruit_veg',
  shop_phone: '+923001234567',
  owner_staff_id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0c',
  owner_name: 'Ali',
  owner_phone: '+923001234567',
  owner_pin_hash: 'pbkdf2-sha256$100000$c2FsdA==$aGFzaA==',
};

function sentBody(fetch: ReturnType<typeof fakeFetch>): unknown {
  return JSON.parse(fetch.mock.calls[0]![1].body!);
}

describe('createApiClient', () => {
  it('calls the base URL and parses the response', async () => {
    const fetch = fakeFetch(200, { ok: true, db: true });
    const api = createApiClient({ baseUrl: 'http://localhost:8787/', fetch });
    await expect(api.health()).resolves.toEqual({ ok: true, db: true });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8787/health', {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  });

  it('sends the bearer token, the device id and a validated, trimmed body', async () => {
    const fetch = fakeFetch(201, { id: SHOP_ID });
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch,
      getToken: () => 'tok',
      getDeviceId: () => Promise.resolve(DEVICE_ID),
    });
    await expect(api.createShop(shop)).resolves.toEqual({ id: SHOP_ID });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/shops');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(init.headers['x-device-id']).toBe(DEVICE_ID);
    expect(sentBody(fetch)).toMatchObject({ name: 'Ali Fruit' });
  });

  it('sends the UI language as X-App-Language when there is one', async () => {
    const withLang = fakeFetch(200, { ok: true, db: true });
    await createApiClient({
      baseUrl: 'https://api.test',
      fetch: withLang,
      getLanguage: () => 'ur',
    }).health();
    expect(withLang.mock.calls[0]![1].headers['x-app-language']).toBe('ur');
    const without = fakeFetch(200, { ok: true, db: true });
    await createApiClient({
      baseUrl: 'https://api.test',
      fetch: without,
      getLanguage: () => '',
    }).health();
    expect(without.mock.calls[0]![1].headers).not.toHaveProperty('x-app-language');
  });

  // Staging 2026-11-27: a POS newer than the API sent X-App-Language, the old API's CORS did not
  // allow it, and every request failed in the browser like a network error.
  const healthy = () =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, db: true }) });
  it('retries once without X-App-Language when the request fails like CORS, then stops sending it', async () => {
    const fetch = vi.fn<FetchLike>((_url, init) =>
      'x-app-language' in init.headers
        ? Promise.reject(new TypeError('Failed to fetch'))
        : healthy(),
    );
    const api = createApiClient({ baseUrl: 'https://api.test', fetch, getLanguage: () => 'ur' });
    await expect(api.health()).resolves.toEqual({ ok: true, db: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![1].headers).not.toHaveProperty('x-app-language');
    await api.health();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]![1].headers).not.toHaveProperty('x-app-language');
  });

  it('offline: the retry fails too, the error is "network" and the language is kept', async () => {
    let online = false;
    const fetch = vi.fn<FetchLike>(() =>
      online ? healthy() : Promise.reject(new TypeError('Failed to fetch')),
    );
    const api = createApiClient({ baseUrl: 'https://api.test', fetch, getLanguage: () => 'ur' });
    await expect(api.health()).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(fetch).toHaveBeenCalledTimes(2);
    online = true;
    await api.health();
    expect(fetch.mock.calls[2]![1].headers['x-app-language']).toBe('ur');
  });

  it('without a language a network failure is not retried', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.reject(new TypeError('Failed to fetch')));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(api.health()).rejects.toMatchObject({ code: 'network' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('invites carry the email language, English by default', async () => {
    const urdu = fakeFetch(200, { id: SHOP_ID });
    await createApiClient({ baseUrl: 'https://api.test', fetch: urdu }).adminCreateInvite(
      SHOP_ID,
      'ali@example.com',
      'ur',
    );
    expect(sentBody(urdu)).toEqual({ email: 'ali@example.com', language: 'ur' });
    const plain = fakeFetch(200, { id: SHOP_ID });
    await createApiClient({ baseUrl: 'https://api.test', fetch: plain }).adminCreateInvite(
      SHOP_ID,
      'ali@example.com',
    );
    expect(sentBody(plain)).toEqual({ email: 'ali@example.com', language: 'en' });
  });

  it('rejects invalid input before calling the network', async () => {
    const fetch = fakeFetch(201, {});
    const api = createApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(api.createShop({ ...shop, owner_phone: '03001234567' })).rejects.toThrow();
    await expect(api.signInWithCode('a@b.pk', '12345')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns our error response into ApiError', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: fakeFetch(409, { error: 'conflict', message: 'shop id already in use' }),
    });
    const error = await api.createShop(shop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'conflict' });
  });

  it('keeps the request id of a 500, also in the message (Sync screen, support)', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: fakeFetch(500, { error: 'internal', request_id: 'req-42' }),
    });
    const error = await api.createShop(shop).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, code: 'internal', requestId: 'req-42' });
    expect((error as Error).message).toContain('[request req-42]');
  });

  it("turns Better Auth's error body into ApiError with its code", async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: fakeFetch(400, { code: 'INVALID_OTP', message: 'Invalid OTP' }),
    });
    await expect(api.signInWithCode('a@b.pk', '123456')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_OTP',
    });
  });

  it('reports a failed request as a network error', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(api.config()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('fails when the server breaks the contract', async () => {
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: fakeFetch(200, { ok: 1 }) });
    await expect(api.health()).rejects.toThrow();
  });
});

describe('auth calls', () => {
  it('asks for a sign-in code', async () => {
    const fetch = fakeFetch(200, { success: true });
    await createApiClient({ baseUrl: 'https://api.test', fetch }).sendSignInCode('ali@shop.pk');
    expect(fetch.mock.calls[0]![0]).toBe('https://api.test/auth/email-otp/send-verification-otp');
    expect(sentBody(fetch)).toEqual({ email: 'ali@shop.pk', type: 'sign-in' });
  });

  it('signs in with the code and returns the bearer token', async () => {
    const fetch = fakeFetch(200, { token: 'tok', user: { id: USER_ID, email: 'ali@shop.pk' } });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(api.signInWithCode('ali@shop.pk', '123456')).resolves.toEqual({
      token: 'tok',
      user: { id: USER_ID, email: 'ali@shop.pk' },
    });
  });

  it('exchanges a one-time token for the session token', async () => {
    const fetch = fakeFetch(200, {
      session: { token: 'session-tok', expiresAt: '2027-01-01T00:00:00.000Z' },
      user: { id: USER_ID, email: 'ali@shop.pk' },
    });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(api.exchangeOneTimeToken('ott')).resolves.toEqual({
      token: 'session-tok',
      user: { id: USER_ID, email: 'ali@shop.pk' },
    });
    expect(sentBody(fetch)).toEqual({ token: 'ott' });
  });

  it('asks for the Google URL without a browser redirect', async () => {
    const fetch = fakeFetch(200, { url: 'https://accounts.google.com/o/oauth2/auth?x=1' });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(
      api.googleSignInUrl('https://pos.test/auth/callback', 'https://pos.test/sign-in'),
    ).resolves.toBe('https://accounts.google.com/o/oauth2/auth?x=1');
    expect(sentBody(fetch)).toMatchObject({ provider: 'google', disableRedirect: true });
  });

  it('returns null from getSession when the session is gone', async () => {
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: fakeFetch(200, null) });
    await expect(api.getSession()).resolves.toBeNull();
  });
});
