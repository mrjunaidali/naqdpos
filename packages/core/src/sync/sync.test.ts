import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type FetchLike } from '../api/client.ts';
import { RegisterDeviceRequest, DeviceRowSchema } from '../api/schemas.ts';
import { SyncPullQuery, SyncPushRequest, SyncPushResponse } from './schemas.ts';
import { isSyncTable, OWNER_DEVICE_TABLES, SYNC_TABLES } from './tables.ts';

const DEVICE_ID = '019a9b8e-1c2d-7e3f-8a4b-5c6d7e8f9a0e';
const entry = (n: number) => ({
  id: `019a9b8e-1c2d-7e3f-8a4b-${String(n).padStart(12, '0')}`,
  table: 'staff',
  op: 'upsert' as const,
  row: { id: 'x' },
});

function fakeFetch(status: number, body: unknown) {
  return vi.fn<FetchLike>(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe('sync schemas', () => {
  it('caps a push at 200 entries', () => {
    const entries = (n: number) => Array.from({ length: n }, (_, i) => entry(i));
    expect(SyncPushRequest.safeParse({ device_id: DEVICE_ID, entries: entries(200) }).success).toBe(
      true,
    );
    expect(SyncPushRequest.safeParse({ device_id: DEVICE_ID, entries: entries(201) }).success).toBe(
      false,
    );
  });

  it('accepts unknown error codes so a newer server never breaks an older app', () => {
    const parsed = SyncPushResponse.parse({
      accepted: [],
      conflicts: [],
      errors: [{ id: 'a', code: 'something_new' }],
    });
    expect(parsed.errors[0]?.code).toBe('something_new');
  });

  it('coerces pull query strings and applies the default limit', () => {
    expect(SyncPullQuery.parse({ device_id: DEVICE_ID, since_seq: '42' })).toEqual({
      device_id: DEVICE_ID,
      since_seq: 42,
      limit: 500,
    });
    expect(SyncPullQuery.safeParse({ device_id: DEVICE_ID, since_seq: -1 }).success).toBe(false);
    expect(
      SyncPullQuery.safeParse({ device_id: DEVICE_ID, since_seq: 0, limit: 1001 }).success,
    ).toBe(false);
  });

  it('registers the tenancy tables; salaries are owner-device only', () => {
    expect(Object.keys(SYNC_TABLES).sort()).toEqual([
      'categories',
      'devices',
      'payment_methods',
      'payments',
      'price_history',
      'product_cost_history',
      'product_costs',
      'products',
      'sale_lines',
      'sales',
      'shops',
      'staff',
      'staff_pins',
      'staff_salaries',
    ]);
    expect([...OWNER_DEVICE_TABLES].sort()).toEqual([
      'product_cost_history',
      'product_costs',
      'staff_salaries',
    ]);
    expect(SYNC_TABLES.staff_pins.scope).toBe('counter_device');
    expect(SYNC_TABLES.devices.pushable).toBe(false);
    expect(isSyncTable('staff')).toBe(true);
    expect(isSyncTable('toString')).toBe(false);
  });

  it('defaults device mode to shop (old requests and old rows)', () => {
    expect(RegisterDeviceRequest.parse({ id: DEVICE_ID, shop_id: DEVICE_ID, name: 'X' }).mode).toBe(
      'shop',
    );
    const row = DeviceRowSchema.parse({
      id: DEVICE_ID,
      shop_id: DEVICE_ID,
      name: 'X',
      code: 'A1',
      registered_by: null,
      last_sync_at: null,
      last_seq_pulled: 0,
      created_at: 'x',
      updated_at: 'x',
      deleted_at: null,
      server_seq: 1,
    });
    expect(row.mode).toBe('shop');
  });
});

describe('client: sync and app version', () => {
  it('sends X-App-Version on every request', async () => {
    const fetch = fakeFetch(200, { ok: true, db: true });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch, appVersion: '1.4.0' });
    await api.health();
    expect(fetch.mock.calls[0]![1].headers['x-app-version']).toBe('1.4.0');
  });

  it('pushes and pulls through the typed methods', async () => {
    const push = fakeFetch(200, { accepted: ['a'], conflicts: [], errors: [] });
    await createApiClient({ baseUrl: 'https://api.test', fetch: push }).syncPush({
      device_id: DEVICE_ID,
      entries: [],
    });
    expect(push.mock.calls[0]![0]).toBe('https://api.test/sync/push');

    const pull = fakeFetch(200, { rows: [], next_seq: 7, has_more: false });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: pull });
    await expect(api.syncPull({ device_id: DEVICE_ID, since_seq: 7 })).resolves.toEqual({
      rows: [],
      next_seq: 7,
      has_more: false,
    });
    expect(pull.mock.calls[0]![0]).toBe(
      `https://api.test/sync/pull?device_id=${DEVICE_ID}&since_seq=7&limit=500`,
    );
  });

  it('turns 426 into ApiError upgrade_required with the minimum version', async () => {
    const fetch = fakeFetch(426, { error: 'upgrade_required', min_version: '2.0.0' });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch, appVersion: '1.0.0' });
    const error = await api
      .syncPull({ device_id: DEVICE_ID, since_seq: 0 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 426, code: 'upgrade_required', minVersion: '2.0.0' });
  });
});
