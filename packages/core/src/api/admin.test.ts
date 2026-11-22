import { describe, expect, it, vi } from 'vitest';
import { AdminVerifyRequest, SetShopStatusRequest } from './admin.ts';
import { createApiClient } from './client.ts';

function client() {
  const fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rows: [], total: 0, page: 2, page_size: 25 }),
    }),
  );
  return {
    api: createApiClient({ baseUrl: 'https://api.test/', fetch, getToken: () => 'tok' }),
    fetch,
  };
}

describe('admin client', () => {
  it('builds the shop list query from filled filters only', async () => {
    const { api, fetch } = client();
    await api.adminListShops({ page: 2, q: ' ali ', status: 'suspended', city: '' });
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe(
      'https://api.test/admin/shops?page=2&q=ali&status=suspended',
    );
  });

  it('a status change needs a reason; a code is six digits or a backup code', () => {
    expect(SetShopStatusRequest.safeParse({ status: 'suspended', reason: '  ' }).success).toBe(
      false,
    );
    expect(SetShopStatusRequest.safeParse({ status: 'suspended', reason: 'unpaid' }).success).toBe(
      true,
    );
    expect(AdminVerifyRequest.safeParse({ code: '12345' }).success).toBe(false);
    expect(AdminVerifyRequest.safeParse({ code: '123456' }).success).toBe(true);
    expect(AdminVerifyRequest.safeParse({ backup_code: 'abcd-efgh' }).success).toBe(true);
  });
});
