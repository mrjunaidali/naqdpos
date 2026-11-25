import { businessDate, nextDate, type DayCloseRow, type SaleRow } from '@naqdpos/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installState, useInstallStore, type BeforeInstallPromptEvent } from '../../app/install.ts';
import { ensurePersistentStorage, STORAGE_PERSISTED_KEY } from '../../app/storage.ts';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { DEVICE_ID, resetDb, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { barItems, moreItems, navHidden } from './navItems.ts';
import { formatDate } from '../../i18n/format.ts';
import { i18n as i18nForDates } from '../../i18n/index.ts';

/** A business date as the English UI shows it ("23 Nov 2026"). */
const shown = (iso: string) => formatDate(iso, i18nForDates.getFixedT('en'));

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const CUSTOMER = '019a9b8e-0000-5000-8000-0000000000a1';
const TODAY = businessDate(new Date());
let n = 0;
const id = () => `019a9b8e-0000-7000-8000-${String(++n).padStart(12, '0')}`;

async function sale(
  date: string,
  staff: string,
  total: number,
  methods: [string, number][],
  khata = 0,
) {
  const saleId = id();
  const row: SaleRow = {
    id: saleId,
    shop_id: SHOP_ID,
    receipt_no: `A1-${String(n).padStart(6, '0')}`,
    business_date: date,
    staff_id: staff,
    customer_id: khata ? CUSTOMER : null,
    order_type: 'walk_in',
    source: 'walk_in',
    subtotal_paisa: total,
    discount_paisa: 0,
    rounding_paisa: 0,
    total_paisa: total,
    note: null,
    discount_approved_by_staff_id: null,
    created_at: new Date().toISOString(),
    device_id: DEVICE_ID,
    server_seq: null,
  };
  await db.sales.put(row);
  for (const [method, amount] of methods) {
    await db.payments.put({
      id: id(),
      shop_id: SHOP_ID,
      business_date: date,
      kind: 'sale',
      sale_id: saleId,
      customer_id: null,
      method_code: method,
      amount_paisa: amount,
      reference: null,
      staff_id: staff,
      created_at: row.created_at,
      device_id: DEVICE_ID,
      server_seq: null,
    });
  }
  if (khata) {
    await db.khata_entries.put({
      id: id(),
      shop_id: SHOP_ID,
      customer_id: CUSTOMER,
      business_date: date,
      type: 'credit_sale',
      amount_paisa: khata,
      sale_id: saleId,
      payment_id: null,
      note: null,
      staff_id: staff,
      created_at: row.created_at,
      device_id: DEVICE_ID,
      server_seq: null,
    });
  }
  return row;
}

async function seedShop(mode: 'owner' | 'shop' = 'owner', as = STAFF_ID) {
  await seedReady(mode);
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await db.customers.put({
    id: CUSTOMER,
    shop_id: SHOP_ID,
    mobile: '+923001234567',
    name: 'Sara',
    address: null,
    credit_limit_paisa: null,
    whatsapp_opt_in: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    device_id: null,
    server_seq: 1,
  });
  await db.products.bulkPut(
    ['p1', 'p2'].map((pid) => ({
      id: pid,
      shop_id: SHOP_ID,
      category_id: null,
      name: pid,
      name_ur: null,
      unit: 'kg' as const,
      sale_price_paisa: 100,
      barcode: null,
      track_stock: true,
      min_qty_milli: null,
      is_combo: false,
      packaging_cost_paisa: 0,
      foc_rule: null,
      search_terms: [],
      created_at: '',
      updated_at: '',
      deleted_at: null,
      device_id: null,
      server_seq: 1,
    })),
  );
  await db.stock_movements.put({
    id: id(),
    shop_id: SHOP_ID,
    product_id: 'p2',
    business_date: TODAY,
    qty_milli: 5000,
    reason: 'purchase',
    ref_id: null,
    note: null,
    staff_id: STAFF_ID,
    created_at: '',
    device_id: null,
    server_seq: 1,
  });
  await writeCurrentStaffId(as);
}

function matchMediaWide(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('min-width') ? wide : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  useInstallStore.setState({ prompt: null, installed: false });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('Home (owner)', () => {
  it('shows the day: total, invoices, cash / wallet / khata split, trend, stat cards and tiles', async () => {
    await seedShop();
    await sale(
      TODAY,
      STAFF_ID,
      30_000,
      [
        ['cash', 10_000],
        ['jazzcash', 15_000],
      ],
      5_000,
    );
    await sale(TODAY, CASHIER, 5_000, [['cash', 5_000]]);
    renderAt('/');
    expect(await screen.findByText("Today's sales")).toBeInTheDocument();
    expect(await screen.findByText('Rs 350', { selector: '.text-4xl' })).toBeInTheDocument();
    expect(screen.getByText('2 invoices')).toBeInTheDocument();
    const split = (label: string) => screen.getByText(label).closest('div')!;
    expect(split('Cash')).toHaveTextContent('Rs 150');
    expect(split('Wallet / bank')).toHaveTextContent('Rs 150');
    expect(split('On khata')).toHaveTextContent('Rs 50');
    expect(screen.getByRole('img', { name: 'Sales over the last 7 days' }).children).toHaveLength(
      7,
    );
    expect(screen.getByRole('link', { name: /Khata owed/ })).toHaveTextContent('Rs 50');
    expect(screen.getByRole('link', { name: /Low stock/ })).toHaveTextContent('1'); // p1 has none
    for (const tile of ['Product', 'Customer', 'Stock in', 'Expense']) {
      expect(screen.getByRole('link', { name: tile })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/sales');
    await waitFor(() => expect(screen.getAllByText(/^A1-/)).toHaveLength(2));
  });

  it('after a 21:00 close, a later sale shows under the next date', async () => {
    await seedShop();
    const close: DayCloseRow = {
      id: id(),
      shop_id: SHOP_ID,
      business_date: TODAY,
      opening_cash_paisa: 0,
      expected_cash_paisa: 0,
      counted_cash_paisa: 0,
      difference_paisa: 0,
      owner_withdrawal_paisa: 0,
      note: null,
      closed_by_staff_id: STAFF_ID,
      closed_at: new Date().toISOString(),
      seen_through_seq: 0,
      device_id: DEVICE_ID,
      server_seq: null,
    };
    await db.day_closes.put(close);
    await sale(TODAY, STAFF_ID, 9_000, [['cash', 9_000]]);
    await sale(nextDate(TODAY), STAFF_ID, 4_000, [['cash', 4_000]]); // made after the close
    renderAt('/');
    expect(await screen.findByText(`Sales for ${shown(nextDate(TODAY))}`)).toBeInTheDocument();
    expect(screen.getByText('Rs 40', { selector: '.text-4xl' })).toBeInTheDocument();
    expect(
      screen.getByText(`Day closed — new sales count for ${shown(nextDate(TODAY))}`),
    ).toBeInTheDocument();
  });

  it('the Customer tile opens the add-customer form', async () => {
    await seedShop();
    const { router } = renderAt('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Customer' }));
    await waitFor(() => expect(router.state.location.search).toBe('?add=1'));
    expect(await screen.findByLabelText('Mobile number')).toBeInTheDocument();
  });
});

describe('Home (cashier)', () => {
  it('own sales only, no trend, no stat cards; Wastage instead of Stock in, no Product tile', async () => {
    await seedShop('shop', CASHIER);
    await sale(TODAY, STAFF_ID, 30_000, [['cash', 30_000]]);
    await sale(TODAY, CASHIER, 5_000, [['cash', 5_000]]);
    renderAt('/');
    expect(await screen.findByText('My sales today')).toBeInTheDocument();
    expect(await screen.findByText('Rs 50', { selector: '.text-4xl' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Sales over the last 7 days' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Khata owed/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Wastage' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Stock in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Product' })).toBeNull();
    await waitFor(() => expect(screen.getAllByText(/^A1-/)).toHaveLength(1));
  });
});

describe('navigation', () => {
  it('items by role', () => {
    expect(barItems('owner')).toEqual({
      left: [
        { key: 'home', to: '/' },
        { key: 'sales', to: '/sales' },
      ],
      right: [{ key: 'products', to: '/products' }],
    });
    expect(barItems('cashier').right).toEqual([{ key: 'khata', to: '/khata' }]);
    expect(barItems('rider')).toEqual({ left: [{ key: 'home', to: '/' }], right: [] });
    expect(moreItems('owner').map((i) => i.key)).toEqual([
      'khata',
      'stock',
      'expenses',
      'closeDay',
      'reports',
      'staff',
      'sync',
      'settings',
    ]);
    expect(moreItems('cashier').map((i) => i.key)).toEqual([
      'khata',
      'stock',
      'expenses',
      'sync',
      'settings',
    ]);
    expect(moreItems('rider').map((i) => i.key)).toEqual(['sync', 'settings']);
  });

  it('hidden in the sale flow, shown elsewhere', () => {
    expect(navHidden('/sale')).toBe(true);
    expect(navHidden('/sale/pay')).toBe(true);
    expect(navHidden('/sale/done/x')).toBe(true);
    expect(navHidden('/sales')).toBe(false);
    expect(navHidden('/')).toBe(false);
  });

  it('phones: the floating bar with the Sale pill and a More sheet', async () => {
    await seedShop('shop', CASHIER);
    renderAt('/');
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Home', 'Sales', 'Sale', 'Khata']);
    fireEvent.click(within(bar).getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(
      within(sheet)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Khata', 'Stock', 'Expenses', 'Sync', 'Settings']);
    expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull();
  });

  it('phones: an icon above every bar label, the same outline style for all', async () => {
    await seedShop();
    renderAt('/');
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    const items = [...within(bar).getAllByRole('link'), within(bar).getByRole('button')];
    expect(items.map((el) => el.textContent)).toEqual([
      'Home',
      'Sales',
      'Sale',
      'Products',
      'More',
    ]);
    for (const el of items) {
      const svg = el.querySelector('svg')!;
      expect(el.firstElementChild).toBe(svg); // above the label (column layout)
      expect(el).toHaveClass('flex-col');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('stroke-width', '1.75');
    }
    expect(items.map((el) => el.querySelector('svg')!.dataset.icon)).toEqual([
      'home',
      'sales',
      'sale',
      'products',
      'more',
    ]);
  });

  it('the header stays fixed at the top and the page pads below it', async () => {
    await seedShop();
    renderAt('/');
    await screen.findByRole('navigation', { name: 'Main' });
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('fixed', 'top-0');
    expect(header.parentElement).toHaveClass('pt-header');
  });

  it('phones: the docked bar reserves its height for the page, and frees it in the sale flow', async () => {
    await seedShop();
    const navHeight = () => document.documentElement.style.getPropertyValue('--nav-h');
    const { router } = renderAt('/');
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(navHeight()).toBe('3.5rem'));
    await act(() => router.navigate('/sale'));
    await waitFor(() => expect(navHeight()).toBe('0px'));
  });

  it('from 768px: a side nav with every item; no nav on the sale screen', async () => {
    matchMediaWide(true);
    await seedShop();
    const { router } = renderAt('/');
    const side = await screen.findByRole('navigation', { name: 'Menu' });
    expect(within(side).getByRole('link', { name: 'Close day' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    await act(() => router.navigate('/sale'));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull());
  });
});

describe('install (US001)', () => {
  const env = (over: Partial<Parameters<typeof installState>[0]>) => ({
    standalone: false,
    hasPrompt: false,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36',
    maxTouchPoints: 5,
    ...over,
  });
  it('per platform', () => {
    expect(installState(env({ standalone: true, hasPrompt: true }))).toBe('installed');
    expect(installState(env({ hasPrompt: true }))).toBe('prompt');
    expect(
      installState(
        env({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1',
        }),
      ),
    ).toBe('ios');
    expect(
      installState(
        env({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/130 Mobile Safari/604.1',
        }),
      ),
    ).toBe('none');
    expect(
      installState(
        env({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15',
          maxTouchPoints: 0,
        }),
      ),
    ).toBe('mac_safari');
    expect(
      installState(
        env({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0' }),
      ),
    ).toBe('firefox_desktop');
    expect(installState(env({}))).toBe('none');
  });

  it('the Home card uses the browser prompt and can be dismissed', async () => {
    await seedShop();
    const prompt = vi.fn(() => Promise.resolve());
    useInstallStore.setState({
      prompt: {
        prompt,
        userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
      } as unknown as BeforeInstallPromptEvent,
    });
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull());
    renderAt('/settings');
    expect(await screen.findByRole('button', { name: 'Install app' })).toBeInTheDocument(); // Settings keeps it
  });
});

describe('storage (US001)', () => {
  it('asks for persistence on each start until granted, then stops', async () => {
    await resetDb();
    const storage = {
      persisted: vi.fn(() => Promise.resolve(false)),
      persist: vi.fn(() => Promise.resolve(false)),
    };
    expect(await ensurePersistentStorage(storage)).toBe(false);
    expect((await db.meta.get(STORAGE_PERSISTED_KEY))?.value).toBe(false);
    storage.persist.mockResolvedValueOnce(true);
    expect(await ensurePersistentStorage(storage)).toBe(true);
    expect(await ensurePersistentStorage(storage)).toBe(true);
    expect(storage.persist).toHaveBeenCalledTimes(2); // not asked again once granted
  });

  it('shows the owner a one-time notice when it was not granted', async () => {
    await seedShop();
    await db.meta.put({ key: STORAGE_PERSISTED_KEY, value: false });
    renderAt('/');
    const notice = await screen.findByText(/may clear the app’s data/);
    fireEvent.click(within(notice.closest('div')!).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByText(/may clear the app’s data/)).toBeNull());
    renderAt('/');
    await screen.findByText("Today's sales");
    expect(screen.queryByText(/may clear the app’s data/)).toBeNull();
  });
});
