import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  adminCatalogue: vi.fn(),
  adminCreateShop: vi.fn(),
  adminCreateInvite: vi.fn(() => Promise.resolve({ id: 'i' })),
  adminRevokeInvite: vi.fn(() => Promise.resolve({ success: true })),
  adminSaveProduct: vi.fn(() => Promise.resolve({ id: 'p' })),
  adminHideProduct: vi.fn(() => Promise.resolve({ success: true })),
  adminImportProducts: vi.fn(),
  adminSaveCategory: vi.fn(() => Promise.resolve({ id: 'c' })),
  adminSaveStaff: vi.fn(() => Promise.resolve({ id: 's' })),
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

const OWNER = '019a9b8e-0000-7000-8000-0000000000a1';
const CASHIER = '019a9b8e-0000-7000-8000-0000000000a2';
const CAT = '019a9b8e-0000-7000-8000-0000000000c1';
const MANGO = '019a9b8e-0000-7000-8000-0000000000d1';
const INVITE = '019a9b8e-0000-7000-8000-0000000000e1';
const catalogue = {
  categories: [{ id: CAT, name: 'Fruits', name_ur: 'پھل', sort: 1 }],
  products: [
    {
      id: MANGO,
      name: 'Mango',
      name_ur: null,
      unit: 'kg',
      category_id: CAT,
      sale_price_paisa: 30000,
      cost_price_paisa: 22000,
      icon: null,
      search_terms: ['aam'],
      hidden: false,
    },
  ],
  invites: [
    {
      id: INVITE,
      email: 'ali@example.test',
      created_at: '2026-11-20T00:00:00Z',
      expires_at: '2026-12-04T00:00:00Z',
      accepted_at: null,
      revoked_at: null,
      status: 'pending',
    },
  ],
  staff: [
    { id: OWNER, name: 'Ali', phone: '+923001234567', role: 'owner', active: true, has_pin: false },
    {
      id: CASHIER,
      name: 'Asif',
      phone: '+923331112222',
      role: 'cashier',
      active: true,
      has_pin: true,
    },
  ],
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
  api.adminCatalogue.mockResolvedValue(catalogue);
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

  it('email provider down: says the code could not be sent instead of spinning', async () => {
    const { ApiError, EMAIL_SEND_FAILED } =
      await vi.importActual<typeof import('@naqdpos/core')>('@naqdpos/core');
    api.sendSignInCode.mockRejectedValueOnce(
      new ApiError(503, EMAIL_SEND_FAILED, "Couldn't send the code, try again"),
    );
    start();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'me@x.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByText("Couldn't send the code, try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeEnabled();
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

describe('new shop and invites (US012)', () => {
  beforeEach(() => {
    setToken('tok-1');
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'ok' });
  });

  it('creates the shop with a normalised mobile and shows the WhatsApp text and wa.me link', async () => {
    api.adminCreateShop.mockResolvedValue({
      shop_id: SHOP,
      owner_staff_id: OWNER,
      invite_id: INVITE,
      emailed: true,
    });
    start();
    fireEvent.click(await screen.findByRole('link', { name: 'New shop' }));
    fireEvent.change(await screen.findByLabelText('Shop name'), {
      target: { value: 'Bilal Sabzi' },
    });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Lahore' } });
    fireEvent.change(screen.getByLabelText("Owner's name"), { target: { value: 'Bilal' } });
    fireEvent.change(screen.getByLabelText("Owner's mobile"), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText("Owner's email"), {
      target: { value: 'Bilal@Example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create shop and invite owner' }));
    expect(
      await screen.findByText('Enter a Pakistani mobile, e.g. 0300 1234567.'),
    ).toBeInTheDocument();
    expect(api.adminCreateShop).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Owner's mobile"), {
      target: { value: '0300 1234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create shop and invite owner' }));
    expect(await screen.findByRole('heading', { name: 'Shop created' })).toBeInTheDocument();
    expect(api.adminCreateShop).toHaveBeenCalledWith({
      name: 'Bilal Sabzi',
      type: 'fruit_veg',
      city: 'Lahore',
      owner_name: 'Bilal',
      owner_mobile: '+923001234567',
      owner_email: 'bilal@example.test',
    });
    const text =
      'Assalam o alaikum! Your shop Bilal Sabzi is ready on NaqdPOS. Open https://pos.test and sign in with bilal@example.test.';
    expect(screen.getByTestId('invite-text')).toHaveTextContent(text);
    // The API also emailed the invite (SMTP set); the WhatsApp text stays.
    expect(screen.getByRole('status')).toHaveTextContent('Email sent to bilal@example.test');
    expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute(
      'href',
      `https://wa.me/923001234567?text=${encodeURIComponent(text)}`,
    );
  });

  it('shop detail: pending invite with resend and revoke; a new invite once none is pending', async () => {
    start(`/shops/${SHOP}`);
    expect(await screen.findByText('pending')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resend message' }));
    expect(screen.getByTestId('invite-text')).toHaveTextContent('sign in with ali@example.test');
    expect(screen.getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href')).toContain(
      'wa.me/923001234567',
    );
    expect(screen.queryByRole('button', { name: 'New invite' })).toBeNull();

    api.adminCatalogue.mockResolvedValue({
      ...catalogue,
      invites: [
        { ...catalogue.invites[0]!, status: 'revoked', revoked_at: '2026-11-23T00:00:00Z' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.adminRevokeInvite).toHaveBeenCalledWith(INVITE));
    fireEvent.change(await screen.findByLabelText('Invite owner email'), {
      target: { value: 'New@Example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'New invite' }));
    await waitFor(() =>
      expect(api.adminCreateInvite).toHaveBeenCalledWith(SHOP, 'new@example.test'),
    );
  });
});

describe('new invite after the owner joined', () => {
  it('shows "The owner has already joined this shop…"', async () => {
    setToken('tok-1');
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'ok' });
    api.adminCatalogue.mockResolvedValue({
      ...catalogue,
      invites: [
        { ...catalogue.invites[0]!, status: 'accepted', accepted_at: '2026-11-21T00:00:00Z' },
      ],
    });
    const { ApiError } = await vi.importActual<typeof import('@naqdpos/core')>('@naqdpos/core');
    api.adminCreateInvite.mockRejectedValueOnce(new ApiError(409, 'owner_joined'));
    start(`/shops/${SHOP}`);
    fireEvent.change(await screen.findByLabelText('Invite owner email'), {
      target: { value: 'second@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'New invite' }));
    expect(
      await screen.findByText(
        "The owner has already joined this shop. Adding a second owner isn't supported yet.",
      ),
    ).toBeInTheDocument();
  });
});

describe('act as shop (US013)', () => {
  beforeEach(() => {
    setToken('tok-1');
    api.adminMe.mockResolvedValue({ email: 'me@x.test', state: 'ok' });
  });

  it('shows the "Acting as" banner on every screen', async () => {
    start(`/shops/${SHOP}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Act as shop' }));
    for (const tab of ['Products', 'Fresh produce list', 'CSV import', 'Categories', 'Staff']) {
      fireEvent.click(await screen.findByRole('link', { name: tab }));
      expect(await screen.findByRole('region', { name: 'Acting as shop' })).toHaveTextContent(
        'Acting as Ali Fruit',
      );
    }
  });

  it('edits a product, keeping the cost as it is; hides it', async () => {
    start(`/shops/${SHOP}/act`);
    expect(await screen.findByText('Rs 300 / kg')).toBeInTheDocument();
    expect(screen.getByText('cost Rs 220')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByLabelText('Unit')).getByRole('option', { name: 'ml' })).toHaveValue(
      'ml',
    );
    fireEvent.change(screen.getByLabelText('Sale price (Rs)'), { target: { value: '320' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    await waitFor(() =>
      expect(api.adminSaveProduct).toHaveBeenCalledWith(SHOP, {
        id: MANGO,
        name: 'Mango',
        name_ur: null,
        unit: 'kg',
        category_id: CAT,
        sale_price_paisa: 32000,
        cost_price_paisa: 22000,
        icon: null,
        search_terms: ['aam'],
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(api.adminHideProduct).toHaveBeenCalledWith(SHOP, MANGO, true));
  });

  it.each(['general', 'grocery', 'meat'])(
    '%s shop: no "Fresh produce list" tab; the route says so and links to CSV import',
    async (type) => {
      api.adminGetShop.mockResolvedValue({ ...detail, shop: { ...detail.shop, type } });
      start(`/shops/${SHOP}/act`);
      await screen.findByRole('link', { name: 'CSV import' });
      expect(screen.queryByRole('link', { name: 'Fresh produce list' })).toBeNull();
      cleanup();

      const router = start(`/shops/${SHOP}/act/produce`);
      expect(
        await screen.findByText('No ready-made list for this shop type yet.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).toBeNull();
      const links = within(
        screen.getByText('No ready-made list for this shop type yet.').parentElement!,
      );
      fireEvent.click(links.getByRole('link', { name: 'CSV import' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP}/act/import`));
    },
  );

  it('fruit_veg shop: the "Fresh produce list" tab is there', async () => {
    start(`/shops/${SHOP}/act`);
    expect(await screen.findByRole('link', { name: 'Fresh produce list' })).toBeInTheDocument();
  });

  it('fresh produce list: existing names are "Added"; picks import with skip and a rate', async () => {
    api.adminImportProducts.mockResolvedValue({ created: 1, updated: 0, skipped: 0 });
    api.adminCatalogue.mockResolvedValue({
      ...catalogue,
      products: [{ ...catalogue.products[0]!, name: 'Onion (red)' }],
    });
    start(`/shops/${SHOP}/act/produce`);
    expect(await screen.findByRole('checkbox', { name: /Onion \(red\)/ })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Potato/ })[0]!);
    fireEvent.change(screen.getByLabelText('Rate for Potato (Rs)'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 products' }));
    await waitFor(() => expect(api.adminImportProducts).toHaveBeenCalled());
    const [, body] = api.adminImportProducts.mock.calls[0]! as unknown as [
      string,
      { rows: { sale_price_paisa: number; category: string }[]; on_existing: string },
    ];
    expect(body.on_existing).toBe('skip');
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ sale_price_paisa: 12000, category: 'Vegetables' });
    expect(await screen.findByText('Added 1 products.')).toBeInTheDocument();
  });

  it('CSV: BOM stripped, preview with row errors, skip / update choice, nothing written before Import', async () => {
    api.adminImportProducts.mockResolvedValue({ created: 1, updated: 1, skipped: 0 });
    start(`/shops/${SHOP}/act/import`);
    expect(await screen.findByText(/CSV UTF-8 \(Comma delimited\)/)).toBeInTheDocument();
    const csv =
      '﻿name,name_ur,unit,category,sale_price,cost_price,search_terms\r\n' +
      'Mango,آم,kg,Fruits,320,,aam\r\n' +
      'Banana,کیلا,dozen,Fruits,180,150,kela;kaila\r\n' +
      ',,kg,,10,,\r\n' +
      'Apple,,box,Fruits,200,,\r\n' +
      'Grapes,,kg,Fruits,-5,,\r\n';
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [new File([csv], 'products.csv', { type: 'text/csv' })] },
    });
    expect(
      await screen.findByText(/5 rows · 3 with errors \(not imported\) · 1 already exist/),
    ).toBeInTheDocument();
    expect(screen.getByText('name is missing')).toBeInTheDocument();
    expect(screen.getByText('unknown unit')).toBeInTheDocument();
    expect(screen.getByText('bad sale price')).toBeInTheDocument();
    expect(screen.getByText('آم')).toBeInTheDocument();
    expect(screen.getByText('exists: skip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 products' })).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Update them from the file' }));
    expect(api.adminImportProducts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 products' }));
    await waitFor(() => expect(api.adminImportProducts).toHaveBeenCalledTimes(1));
    const [, body] = api.adminImportProducts.mock.calls[0]! as unknown as [
      string,
      { rows: { name: string }[]; on_existing: string },
    ];
    expect(body.on_existing).toBe('update');
    expect(body.rows.map((r) => r.name)).toEqual(['Mango', 'Banana']);
    expect(await screen.findByText('Imported: 1 new, 1 updated, 0 skipped.')).toBeInTheDocument();
  });

  it('CSV: Urdu saved in a Windows code page (not UTF-8) is refused', async () => {
    start(`/shops/${SHOP}/act/import`);
    // "آم" in Windows-1256 is C2 E3: not valid UTF-8, so the browser decodes it to U+FFFD.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('name,name_ur,unit,sale_price\r\nMango,'),
      0xc2,
      0xe3,
      ...new TextEncoder().encode(',kg,300\r\n'),
    ]);
    fireEvent.change(await screen.findByLabelText('CSV file'), {
      target: { files: [new File([bytes], 'products.csv')] },
    });
    expect(
      await screen.findByText("Save the file as 'CSV UTF-8' in Excel and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
  });

  it('categories: move down renumbers; add a category', async () => {
    api.adminCatalogue.mockResolvedValue({
      ...catalogue,
      categories: [
        { id: CAT, name: 'Fruits', name_ur: null, sort: 1 },
        { id: OWNER, name: 'Vegetables', name_ur: null, sort: 1 },
      ],
    });
    start(`/shops/${SHOP}/act/categories`);
    fireEvent.click(await screen.findByRole('button', { name: 'Move Fruits down' }));
    await waitFor(() =>
      expect(api.adminSaveCategory).toHaveBeenCalledWith(SHOP, {
        id: CAT,
        name: 'Fruits',
        name_ur: null,
        sort: 2,
      }),
    );
    expect(api.adminSaveCategory).toHaveBeenCalledTimes(1); // Vegetables already has sort 1
    fireEvent.change(screen.getByLabelText('New category'), { target: { value: 'Greens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(() =>
      expect(api.adminSaveCategory).toHaveBeenLastCalledWith(SHOP, {
        name: 'Greens',
        name_ur: null,
      }),
    );
  });

  it('staff: no owner role offered; a cashier PIN is sent hashed; deactivate keeps the phone', async () => {
    start(`/shops/${SHOP}/act/staff`);
    const role = await screen.findByLabelText('Role');
    expect([...role.querySelectorAll('option')].map((o) => o.value)).toEqual(['cashier', 'rider']);
    expect(screen.getByText('owner (by invite)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Naveed' } });
    fireEvent.change(screen.getByLabelText(/^PIN \(optional/), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText('PIN again'), { target: { value: '1243' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));
    expect(await screen.findByText('The PINs do not match.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('PIN again'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));
    await waitFor(() => expect(api.adminSaveStaff).toHaveBeenCalled(), { timeout: 5000 });
    const [, input] = api.adminSaveStaff.mock.calls[0]! as unknown as [
      string,
      { pin_hash: string },
    ];
    expect(input).toMatchObject({ name: 'Naveed', role: 'cashier', phone: null });
    expect(input.pin_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(JSON.stringify(input)).not.toContain('"1234"');

    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(api.adminSaveStaff).toHaveBeenLastCalledWith(SHOP, {
        id: CASHIER,
        name: 'Asif',
        phone: '+923331112222',
        role: 'cashier',
        active: false,
      }),
    );
  }, 15_000);
});
