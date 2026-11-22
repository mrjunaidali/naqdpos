import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToken, setToken } from '../api/session.ts';
import { routes } from '../routes.tsx';

const api = vi.hoisted(() => ({
  config: vi.fn(() => Promise.resolve({ google: false })),
  sendSignInCode: vi.fn(() => Promise.resolve({ success: true })),
  signInWithCode: vi.fn(() => Promise.resolve({ token: 'tok-1', user: {} })),
  signOut: vi.fn(() => Promise.resolve({ success: true })),
  adminMe: vi.fn(),
  adminEnrollTwoFactor: vi.fn(),
  adminVerifyTwoFactor: vi.fn(),
  adminListShops: vi.fn(),
  adminGetShop: vi.fn(),
  adminSetShopStatus: vi.fn(() => Promise.resolve({ id: 'x', status: 'suspended' })),
}));
vi.mock('../api/index.ts', async () => {
  const core = await vi.importActual<typeof import('@naqdpos/core')>('@naqdpos/core');
  return { api, ApiError: core.ApiError };
});

const SHOP = '019a9b8e-0000-7000-8000-00000000000b';
const listRow = {
  id: SHOP,
  name: 'Ali Fruit',
  type: 'fruit_veg',
  city: 'Lahore',
  status: 'active',
  phone: null,
  owner_email: 'ali@example.test',
  created_at: '2026-11-01T00:00:00Z',
  devices: 2,
  last_sync_at: '2026-11-22T10:00:00Z',
  last_sale_date: '2026-11-22',
  sales_7d: 41,
};
const detail = {
  shop: {
    id: SHOP,
    name: 'Ali Fruit',
    type: 'fruit_veg',
    city: 'Lahore',
    address: null,
    phone: null,
    status: 'active',
    suspended_at: null,
    timezone: 'Asia/Karachi',
    created_at: '2026-11-01T00:00:00Z',
    owner_email: 'ali@example.test',
  },
  devices: [
    { id: SHOP, code: 'A1', name: 'Counter', mode: 'shop', last_sync_at: null, retired: false },
  ],
  staff: [{ id: SHOP, name: 'Ali', role: 'owner', active: true }],
  conflicts: [],
  audit: [],
};

function start(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.adminListShops.mockResolvedValue({ rows: [listRow], total: 1, page: 1, page_size: 25 });
  api.adminGetShop.mockResolvedValue(detail);
});

describe('admin sign-in', () => {
  it('signed out: email code sign-in, then the 2FA prompt for this session', async () => {
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'two_factor_required' });
    start();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'me@x.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    fireEvent.change(await screen.findByLabelText('Code from the email'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Two-factor code' })).toBeInTheDocument();
    expect(getToken()).toBe('tok-1');
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }));
    fireEvent.change(screen.getByLabelText('Backup code'), { target: { value: 'abcd-efgh' } });
    api.adminVerifyTwoFactor.mockResolvedValue({ success: true });
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'ok' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(api.adminVerifyTwoFactor).toHaveBeenCalledWith({ backup_code: 'abcd-efgh' });
    expect(await screen.findByRole('heading', { name: 'Shops' })).toBeInTheDocument();
  });

  it('first sign-in: enrol (QR drawn in the page, key, backup codes) before anything else', async () => {
    setToken('tok-1');
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'two_factor_setup' });
    api.adminEnrollTwoFactor.mockResolvedValue({
      totp_uri: 'otpauth://totp/NaqdPOS:me%40x.test?secret=JBSWY3DPEHPK3PXP&issuer=NaqdPOS',
      secret: 'JBSWY3DPEHPK3PXP',
      backup_codes: ['aaaa-1111', 'bbbb-2222'],
    });
    start();
    const qr = await screen.findByRole('img', { name: 'QR code for the authenticator app' });
    expect(qr.querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expect(screen.getByText('aaaa-1111')).toBeInTheDocument();
    expect(api.adminListShops).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    const turnOn = screen.getByRole('button', { name: 'Turn on two-factor' });
    expect(turnOn).toBeDisabled(); // backup codes not confirmed yet
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have saved my backup codes' }));
    // The first code turns 2FA on and the server replaces the session: keep the new token.
    api.adminVerifyTwoFactor.mockResolvedValue({ success: true, token: 'tok-2' });
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'ok' });
    fireEvent.click(turnOn);
    expect(await screen.findByRole('heading', { name: 'Shops' })).toBeInTheDocument();
    expect(getToken()).toBe('tok-2');
  });

  it('a signed-in user who is not an admin sees "Not an admin"', async () => {
    setToken('tok-1');
    api.adminMe.mockResolvedValue({ email: 'owner@x.test', state: 'admin_required' });
    start();
    expect(await screen.findByRole('heading', { name: 'Not an admin' })).toBeInTheDocument();
  });

  it('a 401 (12-hour limit) returns to sign-in', async () => {
    setToken('tok-1');
    api.adminMe
      .mockResolvedValueOnce({ email: 'me@x.test', state: 'ok' })
      .mockResolvedValue({ email: 'me@x.test', state: 'session_expired' });
    const { ApiError } = await vi.importActual<typeof import('@naqdpos/core')>('@naqdpos/core');
    api.adminListShops.mockRejectedValue(new ApiError(401, 'unauthorized', 'session_expired'));
    start();
    expect(await screen.findByText('Your admin session ended. Sign in again.')).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});

describe('shops (US010, US011)', () => {
  beforeEach(() => {
    setToken('tok-1');
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'ok' });
  });

  it('lists shops with the columns; filters and search build the query', async () => {
    start();
    expect(await screen.findByRole('link', { name: 'Ali Fruit' })).toBeInTheDocument();
    expect(screen.getByText('ali@example.test')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'suspended' } });
    await waitFor(() =>
      expect(api.adminListShops).toHaveBeenLastCalledWith({ page: 1, status: 'suspended' }),
    );
    fireEvent.change(screen.getByLabelText('Search shops'), { target: { value: 'ali@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(api.adminListShops).toHaveBeenLastCalledWith({
        page: 1,
        status: 'suspended',
        q: 'ali@',
      }),
    );
  });

  it('suspending needs a reason and sends it', async () => {
    start(`/shops/${SHOP}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend shop' }));
    const yes = screen.getByRole('button', { name: 'Yes, suspend' });
    expect(yes).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason (required, saved in the audit log)'), {
      target: { value: 'unpaid' },
    });
    fireEvent.click(yes);
    await waitFor(() =>
      expect(api.adminSetShopStatus).toHaveBeenCalledWith(SHOP, {
        status: 'suspended',
        reason: 'unpaid',
      }),
    );
  });
});
