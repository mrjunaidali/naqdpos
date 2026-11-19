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

const shop: CreateShopRequest = {
  shop_id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
  name: '  Ali Fruit  ',
  type: 'fruit_veg',
  shop_phone: '03001234567',
  owner_staff_id: '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0c',
  owner_name: 'Ali',
  owner_phone: '+923001234567',
};

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

  it('sends the bearer token and a validated, trimmed body', async () => {
    const fetch = fakeFetch(201, { id: shop.shop_id });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch, getToken: () => 'tok' });
    await expect(api.createShop(shop)).resolves.toEqual({ id: shop.shop_id });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/shops');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body!)).toMatchObject({ name: 'Ali Fruit' });
  });

  it('rejects invalid input before calling the network', async () => {
    const fetch = fakeFetch(201, {});
    const api = createApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(api.createShop({ ...shop, shop_id: 'not-a-uuid' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns an error response into ApiError', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: fakeFetch(409, { error: 'conflict', message: 'shop id already in use' }),
    });
    const error = await api.createShop(shop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'conflict' });
  });

  it('fails when the server breaks the contract', async () => {
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: fakeFetch(200, { ok: 1 }) });
    await expect(api.health()).rejects.toThrow();
  });
});
