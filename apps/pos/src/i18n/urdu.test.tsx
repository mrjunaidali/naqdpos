// US009: the app in Urdu. Smoke tests over the main screens in Urdu mode: right-to-left, Urdu
// labels (no raw keys, no TODO-ur), Latin digits for money, quantities and dates, and product /
// category names from name_ur with a fallback to name.
import { businessDate, FRESH_PRODUCE, makeLine, type CartLine } from '@naqdpos/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/index.ts';
import { db } from '../db/schema.ts';
import { createFromPresets } from '../features/catalogue/catalogueRepo.ts';
import { findOrAddCustomer } from '../features/khata/khataRepo.ts';
import { useCartStore } from '../features/sale/cartStore.ts';
import { completeSale } from '../features/sale/completeSale.ts';
import { writeCurrentStaffId } from '../staff/currentStaff.ts';
import { resetApiMock } from '../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID } from '../test/fixtures.ts';
import { renderAt } from '../test/render.tsx';
import en from './en.json';
import ur from './ur.json';
import { formatDate } from './format.ts';
import { i18n, LANGUAGE_STORAGE_KEY } from './index.ts';
import { flattenMessages } from './reviewSheet.ts';

vi.mock('../api/index.ts', () => import('../test/apiMock.ts'));
vi.mock('../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')), start: vi.fn() },
}));

const mocked = vi.mocked(api);
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
const KEYS = flattenMessages(en).map(([key]) => key);
const TODAY = businessDate(new Date());
const preset = (key: string) => FRESH_PRODUCE.find((p) => p.key === key)!;

async function seedShop() {
  await seedReady('owner');
  await seedPin(STAFF_ID, '4821');
  await writeCurrentStaffId(STAFF_ID);
  await createFromPresets(
    [
      { preset: preset('tomato'), rate: 16500 },
      { preset: preset('banana'), rate: 125000 },
    ],
    STAFF_ID,
  );
  // An owner-made product without an Urdu name: shown in English in Urdu mode.
  const banana = (await db.products.toArray()).find((p) => p.name === 'Banana')!;
  await db.products.update(banana.id, { name_ur: null });
  await db.outbox.clear();
}

/** A sale of 1 kg tomatoes (Rs 165), on a customer's khata. */
async function khataSale() {
  const p = (await db.products.toArray()).find((x) => x.name === 'Tomato')!;
  useCartStore.getState().put(
    makeLine(
      {
        product_id: p.id,
        name: p.name,
        name_ur: p.name_ur,
        unit: p.unit,
        icon: null,
        unit_price_paisa: p.sale_price_paisa,
      },
      1000,
    ) as CartLine,
  );
  const customer = await findOrAddCustomer('0300 1234567', 'Sara', STAFF_ID);
  useCartStore.getState().setCustomer(customer.id);
  const rows = await completeSale([], { khataPaisa: 16500 });
  return { saleId: rows.sale.id, customerId: customer.id };
}

/** What every Urdu screen must satisfy. */
function expectUrduScreen() {
  expect(document.documentElement.dir).toBe('rtl');
  expect(document.documentElement.lang).toBe('ur');
  const text = document.body.textContent ?? '';
  expect(text).toMatch(/[؀-ۿ]/);
  expect(text).not.toMatch(ARABIC_INDIC_DIGITS);
  expect(text).not.toContain('TODO-ur');
  expect(KEYS.filter((key) => text.includes(key))).toEqual([]);
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  useCartStore.setState({
    lines: [],
    billDiscount: null,
    approval: null,
    customerId: null,
    ready: true,
  });
  await act(() => i18n.changeLanguage('ur'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(() => i18n.changeLanguage('en'));
});

describe('Urdu screens (US009)', () => {
  it('home', async () => {
    await seedShop();
    renderAt('/');
    expect(await screen.findByRole('link', { name: ur.home.newSale })).toBeInTheDocument();
    expectUrduScreen();
  });

  it('sale grid: name_ur, English fallback, Latin prices; back arrow mirrors', async () => {
    await seedShop();
    renderAt('/sale');
    expect(await screen.findByRole('heading', { name: ur.sale.title })).toBeInTheDocument();
    expect(await screen.findByText('ٹماٹر')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument(); // no name_ur → name
    expect(screen.getByText('Rs 165/کلو')).toBeInTheDocument();
    expect(screen.getByText('Rs 1,250/درجن')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: ur.sale.back })).toHaveClass('rtl:rotate-180');
    expectUrduScreen();
  });

  it('cart and pay screen with Latin money and quantities', async () => {
    await seedShop();
    const p = (await db.products.toArray()).find((x) => x.name === 'Tomato')!;
    useCartStore.getState().put(
      makeLine(
        {
          product_id: p.id,
          name: p.name,
          name_ur: p.name_ur,
          unit: p.unit,
          icon: null,
          unit_price_paisa: p.sale_price_paisa,
        },
        1500,
      ) as CartLine,
    );
    renderAt('/sale');
    fireEvent.click(await screen.findByRole('button', { name: /ٹوکری کھولیں/ }));
    expect(await screen.findByText('1.5 کلو × Rs 165')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 247.50').length).toBeGreaterThan(0);
    expectUrduScreen();

    renderAt('/sale/pay');
    expect(await screen.findByRole('heading', { name: ur.pay.title })).toBeInTheDocument();
    expectUrduScreen();
  });

  it('khata list and ledger: Urdu dates with Latin digits', async () => {
    await seedShop();
    const { customerId } = await khataSale();
    const list = renderAt('/khata');
    expect(await screen.findByText('Sara')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 165').length).toBeGreaterThan(0);
    expectUrduScreen();
    list.unmount();

    renderAt(`/khata/${customerId}`);
    expect(await screen.findByText(ur.khata.type.credit_sale)).toBeInTheDocument();
    const date = formatDate(TODAY, i18n.getFixedT('ur'));
    expect(date).toMatch(/^\d{1,2} \S+ \d{4}$/);
    expect(screen.getByText(date)).toBeInTheDocument();
    expectUrduScreen();
  });

  it('receipt preview in Urdu: name_ur and right-to-left paper', async () => {
    await seedShop();
    await db.shops.update(SHOP_ID, { receipt_language: 'ur' });
    const { saleId } = await khataSale();
    renderAt(`/receipt/${saleId}`);
    expect(await screen.findByText('ٹماٹر')).toBeInTheDocument();
    const paper = document.querySelector('.receipt')!;
    expect(paper).toHaveAttribute('dir', 'rtl');
    expect(paper).toHaveAttribute('lang', 'ur');
    expectUrduScreen();
  });

  it('close day', async () => {
    await seedShop();
    await khataSale();
    renderAt('/closing');
    const date = formatDate(TODAY, i18n.getFixedT('ur'));
    expect(
      await screen.findByRole('heading', { name: `${ur.closing.title} — ${date}` }),
    ).toBeInTheDocument();
    expectUrduScreen();
  });

  it('reports tables: name_ur with fallback, Latin numbers', async () => {
    await seedShop();
    mocked.reportProducts.mockResolvedValue([
      productRow({ key: 'a', name: 'Mango', name_ur: 'آم', sales_paisa: 125000 }),
      productRow({ key: 'b', name: 'Kiwi', name_ur: null, sales_paisa: 5000 }),
    ]);
    renderAt('/reports/products');
    expect(await screen.findByText('آم')).toBeInTheDocument();
    expect(screen.getByText('Kiwi')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 1,250').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('columnheader', { name: new RegExp(ur.reports.col.product) }),
    ).toBeInTheDocument();
    expectUrduScreen();
  });

  it('other main screens render in Urdu', async () => {
    await seedShop();
    for (const [path, heading] of [
      // The title names the business date shown ('سیل — 26 نومبر 2026').
      ['/sales', new RegExp('^' + ur.sales.titleDay.split('{{')[0])],
      ['/products', ur.products.title],
      ['/stock', ur.stock.title],
      ['/expenses', ur.expenses.title],
      ['/settings', ur.settings.title],
      ['/sync', ur.sync.title],
    ] as const) {
      const view = renderAt(path);
      expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
      expectUrduScreen();
      view.unmount();
    }
  });

  it('Settings switches the language and keeps it on the device', async () => {
    await seedShop();
    renderAt('/settings');
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(ur.language.switchLabel) }),
    );
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(await screen.findByRole('heading', { name: en.settings.title })).toBeInTheDocument();
  });

  it('the sign-in screen offers the language switch too', async () => {
    renderAt('/sign-in');
    expect(await screen.findByRole('heading', { name: ur.signIn.title })).toBeInTheDocument();
    expectUrduScreen();
    fireEvent.click(screen.getByRole('button', { name: ur.language.switchLabel }));
    await waitFor(() => expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en'));
  });
});

function productRow(overrides: {
  key: string;
  name: string;
  name_ur: string | null;
  sales_paisa: number;
}) {
  return {
    product_id: null,
    unit: 'kg',
    custom: false,
    lines: 1,
    qty_milli: 1500,
    foc_qty_milli: 0,
    costed_sales_paisa: 0,
    cost_paisa: 0,
    profit_paisa: 0,
    uncosted_sales_paisa: overrides.sales_paisa,
    ...overrides,
  };
}
