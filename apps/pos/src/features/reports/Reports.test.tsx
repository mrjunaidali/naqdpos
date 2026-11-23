import { businessDate, rangePreset } from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../packages/core/src/fixtures/report-month.json' with { type: 'json' };
import { api, ApiError } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { deviceRow } from '../../test/fixtures.ts';
import { changeDeviceMode } from '../devices/deviceMode.ts';
import { signOutOnDevice } from '../settings/signOut.ts';
import { reportKey } from './reportsData.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const mocked = vi.mocked(api);
const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const TODAY = businessDate(new Date());
const summary = fixture.expected.summary;
const products = [
  {
    ...fixture.expected.products[0]!,
    product_id: fixture.products[0]!.id,
    name_ur: 'آم',
    unit: 'kg',
  },
  { ...fixture.expected.products[1]!, product_id: null, name_ur: null, unit: 'piece' },
  {
    ...fixture.expected.products[3]!,
    product_id: fixture.products[2]!.id,
    name_ur: null,
    unit: 'kg',
  },
];

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

async function seedShop(mode: 'owner' | 'shop') {
  await seedReady(mode);
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await writeCurrentStaffId(STAFF_ID);
}

/** Captures what a CSV download would save. */
function captureDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  let last: Blob | undefined;
  URL.createObjectURL = vi.fn((b: Blob) => {
    last = b;
    return 'blob:report';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: last! });
  });
  return saved;
}

beforeEach(async () => {
  resetApiMock();
  setOnline(true);
  await resetDb();
  mocked.reportSummary.mockResolvedValue(summary);
  mocked.reportProducts.mockResolvedValue(products);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('dashboard (US048)', () => {
  it('owner device: today from the server, cards, top products; results cached with their time', async () => {
    await seedShop('owner');
    renderAt('/reports');
    expect(await screen.findByText('Rs 2,383')).toBeInTheDocument(); // net sales
    expect(mocked.reportSummary).toHaveBeenCalledWith({ shop_id: SHOP_ID, from: TODAY, to: TODAY });
    expect(screen.getByText('Profit on items with a cost price')).toBeInTheDocument();
    expect(screen.getByText('Rs 359.32')).toBeInTheDocument();
    expect(screen.getByText('Sales without a cost price')).toBeInTheDocument();
    expect(screen.getByText('3 lines, 2 products')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add cost prices to see the full profit' }),
    ).toHaveAttribute('href', '/products/rates');
    expect(screen.getByText('1 customer owes')).toBeInTheDocument();
    const top = await screen.findByRole('heading', { name: 'Top 5 products' });
    expect(await within(top.parentElement!).findByText('Mango')).toBeInTheDocument();
    expect(within(top.parentElement!).getByText('custom item')).toBeInTheDocument();
    await waitFor(async () => expect(await db.report_cache.count()).toBe(2));
    const row = await db.report_cache.get(reportKey('summary', SHOP_ID, TODAY, TODAY));
    expect(row?.value).toEqual(summary);

    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    const last = rangePreset('last_month', TODAY);
    await waitFor(() =>
      expect(mocked.reportSummary).toHaveBeenLastCalledWith({ shop_id: SHOP_ID, ...last }),
    );
  });

  it('owner device offline: the cached result with "As of … — offline"; nothing cached: needs internet', async () => {
    await seedShop('owner');
    await db.report_cache.put({
      key: reportKey('summary', SHOP_ID, TODAY, TODAY),
      saved_at: '2026-11-20T10:00:00.000Z',
      value: summary,
    });
    setOnline(false);
    renderAt('/reports');
    expect(await screen.findByText(/^As of .* — offline$/)).toBeInTheDocument();
    expect(screen.getByText('Rs 2,383')).toBeInTheDocument();
    expect(screen.getByText('Reports need internet.')).toBeInTheDocument(); // products: not cached
    expect(mocked.reportSummary).not.toHaveBeenCalled();
  });

  it('owner device: a network failure while "online" also falls back to the cache', async () => {
    await seedShop('owner');
    await db.report_cache.put({
      key: reportKey('summary', SHOP_ID, TODAY, TODAY),
      saved_at: '2026-11-20T10:00:00.000Z',
      value: summary,
    });
    mocked.reportSummary.mockRejectedValue(new ApiError(0, 'network'));
    renderAt('/reports');
    expect(await screen.findByText(/— offline$/)).toBeInTheDocument();
  });

  it('shop device: owner PIN first, results shown but never stored; offline needs internet', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    renderAt('/reports');
    expect(await screen.findByRole('heading', { name: 'Owner PIN needed' })).toBeInTheDocument();
    for (const d of '4821') fireEvent.click(await screen.findByRole('button', { name: d }));
    expect(await screen.findByText('Rs 2,383')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add cost prices to see the full profit' }),
    ).toHaveAttribute('href', '/products');
    await screen.findByText('Mango');
    expect(await db.report_cache.count()).toBe(0);

    setOnline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(await screen.findAllByText('Reports need internet.')).toHaveLength(2);
    expect(await db.report_cache.count()).toBe(0);
  });

  it('a cashier does not see Reports in the menu (the route asks for the owner)', async () => {
    const { moreItems } = await import('../home/navItems.ts');
    expect(moreItems('cashier').some((i) => i.key === 'reports')).toBe(false);
    expect(moreItems('owner').some((i) => i.key === 'reports')).toBe(true);
  });
});

describe('monthly P&L (US047)', () => {
  it('P&L with gross profit on costed items, net excluding uncosted sales, unclosed days; CSV', async () => {
    await seedShop('owner');
    const saved = captureDownloads();
    renderAt('/reports/monthly');
    const month = TODAY.slice(0, 7);
    await waitFor(() =>
      expect(mocked.reportSummary).toHaveBeenCalledWith(
        expect.objectContaining({ from: `${month}-01` }),
      ),
    );
    expect(await screen.findByText('Gross profit (items with a cost price)')).toBeInTheDocument();
    expect(screen.getByText('Net (excluding sales without a cost price)')).toBeInTheDocument();
    expect(screen.getByText('Rs -25,065.68')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(
      screen.getByText('These days are not closed yet: 20 Oct 2026. Totals still show.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Customers owe at month end')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-10' } });
    await waitFor(() =>
      expect(mocked.reportSummary).toHaveBeenLastCalledWith({
        shop_id: SHOP_ID,
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(saved[0]!.name).toBe('profit-and-loss-2026-10.csv');
    expect(await saved[0]!.blob.text()).toContain(
      'Net (excluding sales without cost price),-25065.68',
    );
  });

  it('every line costed: plain "Net", no cost-price note; today shown as still open', async () => {
    await seedShop('owner');
    mocked.reportSummary.mockResolvedValue({
      ...summary,
      uncosted_sales_paisa: 0,
      uncosted_lines: 0,
      uncosted_products: 0,
      unclosed_days: [],
      today_open: true,
    });
    renderAt('/reports/monthly');
    expect(await screen.findByText('Net')).toBeInTheDocument();
    expect(screen.queryByText('Add cost prices to see the full profit')).toBeNull();
    expect(screen.getByText('Today (still open)')).toBeInTheDocument();
    expect(screen.queryByText(/not closed yet/)).toBeNull();
  });
});

describe('products and staff (US049)', () => {
  it('products: sortable by a column, custom items flagged, CSV', async () => {
    await seedShop('owner');
    const saved = captureDownloads();
    renderAt('/reports/products');
    await screen.findByText('Mango');
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(names()).toEqual(['Mango', 'Basketcustom item', 'Tomato']);
    fireEvent.click(screen.getByRole('button', { name: 'Profit' }));
    expect(names()).toEqual(['Mango', 'Tomato', 'Basketcustom item']);
    fireEvent.click(screen.getByRole('button', { name: /Profit/ }));
    expect(names()).toEqual(['Basketcustom item', 'Tomato', 'Mango']);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const text = await saved[0]!.blob.text();
    expect(text).toContain('Basket,,piece,yes,1.000,0.000,500.08');
  });

  it('staff: rows from the server and CSV', async () => {
    await seedShop('owner');
    mocked.reportStaff.mockResolvedValue([
      { ...fixture.expected.staff[0]!, staff_id: STAFF_ID },
      { ...fixture.expected.staff[1]!, staff_id: CASHIER },
    ]);
    renderAt('/reports/staff');
    expect(await screen.findByText('Cashier A')).toBeInTheDocument();
    expect(screen.getByText('Rs 87')).toBeInTheDocument(); // cashier's discounts
  });
});

describe('expenses (US068)', () => {
  const report = {
    from: '2026-11-01',
    to: '2026-11-30',
    lines: [
      {
        id: '019a0000-0000-7000-8000-000000000804',
        business_date: '2026-11-18',
        category_id: '019a0000-0000-7000-8000-000000000a02',
        category_name: 'Bags',
        category_name_ur: null,
        category_i18n_key: null,
        amount_paisa: 30000,
        paid_method_code: 'jazzcash',
        note: 'Large bags',
        payee: null,
        staff_id: CASHIER,
        staff_name: 'Bilal',
        reverses_expense_id: null,
        reversal_reason: null,
        created_at: '2026-11-18T05:00:00Z',
      },
    ],
    line_count: 1,
    total_paisa: 30000,
    by_category: [{ key: '019a0000-0000-7000-8000-000000000a02', amount_paisa: 30000 }],
    by_method: [{ key: 'jazzcash', amount_paisa: 30000 }],
    previous: {
      from: '2026-10-01',
      to: '2026-10-31',
      total_paisa: 50000,
      by_category: [{ key: '019a0000-0000-7000-8000-000000000a02', amount_paisa: 50000 }],
    },
  };

  it('list with filters sent to the server, total for the filter; monthly view against last month', async () => {
    await seedShop('owner');
    await db.expense_categories.put({
      id: '019a0000-0000-7000-8000-000000000a02',
      shop_id: SHOP_ID,
      name: 'Bags',
      name_ur: null,
      i18n_key: null,
      icon: null,
      sort: 1,
      archived_at: null,
      created_at: '',
      updated_at: '',
      deleted_at: null,
      device_id: null,
      server_seq: 1,
    });
    mocked.reportExpenses.mockResolvedValue(report);
    renderAt('/reports/expenses');
    expect(await screen.findByText('Total (1 entry)')).toBeInTheDocument();
    expect(screen.getByText(/Large bags/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: '019a0000-0000-7000-8000-000000000a02' },
    });
    fireEvent.change(screen.getByLabelText('Staff'), { target: { value: CASHIER } });
    await waitFor(() =>
      expect(mocked.reportExpenses).toHaveBeenLastCalledWith(
        expect.objectContaining({
          category_id: '019a0000-0000-7000-8000-000000000a02',
          staff_id: CASHIER,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'By month' }));
    expect(await screen.findByText('By category, against last month')).toBeInTheDocument();
    expect(screen.getByText('Rs -200')).toBeInTheDocument(); // 300 this month vs 500 last month
  });
});

describe('report cache lifecycle', () => {
  const cacheOne = () =>
    db.report_cache.put({ key: 'summary:x', saved_at: new Date().toISOString(), value: summary });

  it('switching the device to shop mode empties it', async () => {
    await seedShop('owner');
    await cacheOne();
    mocked.setDeviceMode.mockResolvedValue(deviceRow({ mode: 'shop' }));
    await changeDeviceMode('shop');
    expect(await db.report_cache.count()).toBe(0);
  });

  it('signing out empties it', async () => {
    await seedShop('owner');
    await cacheOne();
    mocked.signOut.mockResolvedValue({ success: true });
    await signOutOnDevice();
    expect(await db.report_cache.count()).toBe(0);
  });
});
