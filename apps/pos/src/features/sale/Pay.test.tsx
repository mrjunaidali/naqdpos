import { FRESH_PRODUCE, makeLine, type CartLine, type PaymentMethodRow } from '@naqdpos/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { createFromPresets } from '../catalogue/catalogueRepo.ts';
import { CART_KEY, useCartStore } from './cartStore.ts';
import {
  completeSale,
  RECEIPT_COUNTER_KEY,
  reconcileReceiptCounter,
  SaleNotCompleted,
} from './completeSale.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const preset = (key: string) => FRESH_PRODUCE.find((p) => p.key === key)!;
const NOW = '2026-11-21T10:00:00.000Z';

function method(code: string, label: string, sort: number, active = true): PaymentMethodRow {
  return {
    id: `019a9b8e-0000-7000-8000-00000000f00${sort}`,
    shop_id: SHOP_ID,
    code,
    label,
    active,
    sort,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    device_id: null,
    server_seq: 30 + sort,
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

async function seedShop(mode: 'owner' | 'shop' = 'owner') {
  await seedReady(mode);
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await seedPin(CASHIER, '1234');
  await db.payment_methods.bulkPut([
    method('cash', 'Cash', 1),
    method('jazzcash', 'JazzCash', 2),
    method('easypaisa', 'Easypaisa', 3),
    method('bank', 'Bank transfer', 4),
  ]);
  await createFromPresets([{ preset: preset('tomato'), rate: 16500 }], STAFF_ID);
  await db.outbox.clear();
}

/** 1.3 kg tomatoes at Rs 165 = Rs 214.50 → bill Rs 215. */
function putTomatoes() {
  const line = makeLine(
    {
      product_id: 'p-tomato',
      name: 'Tomato',
      name_ur: 'ٹماٹر',
      unit: 'kg',
      icon: '🍅',
      unit_price_paisa: 16500,
    },
    1300,
  ) as CartLine;
  useCartStore.getState().put(line);
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  setOnline(true);
});
afterEach(() => setOnline(true));

describe('completeSale: one transaction', () => {
  it('writes sale, lines and payments with outbox entries in order, numbers the receipt, clears the cart', async () => {
    await seedShop();
    putTomatoes();
    const rows = await completeSale(
      [
        { method_code: 'jazzcash', amount_paisa: 10000, reference: 'TX1' },
        { method_code: 'cash', amount_paisa: 11500, reference: null },
      ],
      { now: new Date('2026-11-21T19:00:00.000Z') }, // midnight in Karachi
    );
    expect(rows.sale).toMatchObject({
      receipt_no: 'A1-000001',
      business_date: '2026-11-22',
      staff_id: STAFF_ID,
      device_id: rows.sale.device_id,
      subtotal_paisa: 21450,
      rounding_paisa: 50,
      total_paisa: 21500,
    });
    expect(await db.sales.count()).toBe(1);
    expect(await db.sale_lines.count()).toBe(1);
    expect(await db.payments.count()).toBe(2);
    const outbox = await db.outbox.orderBy('id').toArray();
    expect(outbox.map((e) => e.table)).toEqual(['sales', 'sale_lines', 'payments', 'payments']);
    expect(outbox.every((e) => e.actor_staff_id === STAFF_ID)).toBe(true);
    expect((await db.meta.get(RECEIPT_COUNTER_KEY))?.value).toEqual({ code: 'A1', last: 1 });
    expect(useCartStore.getState().lines).toEqual([]);
    expect((await db.meta.get(CART_KEY))?.value).toEqual({ lines: [] });
  });

  it('writes nothing when any step fails (no rows, no outbox, counter and cart kept)', async () => {
    await seedShop();
    putTomatoes();
    const realAdd = db.outbox.add.bind(db.outbox);
    const spy = vi.spyOn(db.outbox, 'add');
    spy.mockImplementationOnce(realAdd);
    // A failing write (Dexie's own promise type is not needed for a rejection in a test).
    spy.mockImplementationOnce((() =>
      Promise.reject(new Error('disk full'))) as unknown as typeof db.outbox.add);
    await expect(
      completeSale([{ method_code: 'cash', amount_paisa: 21500, reference: null }]),
    ).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await db.sales.count()).toBe(0);
    expect(await db.sale_lines.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.get(RECEIPT_COUNTER_KEY)).toBeUndefined();
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('refuses a payment that does not cover the bill', async () => {
    await seedShop();
    putTomatoes();
    await expect(
      completeSale([{ method_code: 'cash', amount_paisa: 20000, reference: null }]),
    ).rejects.toEqual(new SaleNotCompleted('not_paid'));
    expect(await db.sales.count()).toBe(0);
  });

  it('counts receipts up, also when the counter was lost', async () => {
    await seedShop();
    for (let i = 0; i < 2; i++) {
      putTomatoes();
      await completeSale([{ method_code: 'cash', amount_paisa: 21500, reference: null }]);
    }
    expect((await db.sales.toArray()).map((s) => s.receipt_no).sort()).toEqual([
      'A1-000001',
      'A1-000002',
    ]);

    await db.meta.delete(RECEIPT_COUNTER_KEY); // e.g. meta lost, sales still on the device
    expect(await reconcileReceiptCounter()).toBe(2);
    await db.meta.delete(RECEIPT_COUNTER_KEY);
    putTomatoes();
    const third = await completeSale([
      { method_code: 'cash', amount_paisa: 21500, reference: null },
    ]);
    expect(third.sale.receipt_no).toBe('A1-000003');
  });
});

const panel = () => screen.getByRole('dialog');
const pressAmount = (keys: string) => {
  for (const k of keys)
    fireEvent.click(screen.getByRole('button', { name: k === '.' ? 'Decimal point' : k }));
};

describe('pay screen (US034, US035)', () => {
  it('cash with change; the success screen shows the receipt; the cart is cleared', async () => {
    await seedShop();
    putTomatoes();
    const { router } = renderAt('/sale/pay');
    expect(await screen.findByText('Rs 215')).toBeInTheDocument();
    expect(screen.getByText('Bill Rs 214.50, rounded +Rs 0.50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rs 500' }));
    expect(screen.getByText('Change: Rs 285')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete sale' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/sale\/done\//));
    expect(await screen.findByText('A1-000001')).toBeInTheDocument();
    expect(screen.getByText('Rs 285')).toBeInTheDocument(); // change
    const [payment] = await db.payments.toArray();
    expect(payment).toMatchObject({ method_code: 'cash', amount_paisa: 21500 }); // applied, not 500
    expect(useCartStore.getState().lines).toEqual([]);
    fireEvent.click(screen.getByRole('link', { name: 'New sale' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale'));
  });

  it('Exact fills in what is due', async () => {
    await seedShop();
    putTomatoes();
    renderAt('/sale/pay');
    fireEvent.click(await screen.findByRole('button', { name: 'Exact' }));
    expect(screen.getByText('Change: Rs 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete sale' })).toBeInTheDocument();
  });

  it('split: JazzCash with a reference, then cash for the rest', async () => {
    await seedShop();
    putTomatoes();
    renderAt('/sale/pay');
    fireEvent.click(await screen.findByRole('button', { name: 'JazzCash' }));
    // prefilled with what is left; type 100 instead
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    pressAmount('100');
    fireEvent.change(screen.getByLabelText('Reference number (optional)'), {
      target: { value: 'TX77' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    expect(await screen.findByText('Remaining Rs 115')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete sale' }));
    await waitFor(async () => expect(await db.payments.count()).toBe(2));
    const payments = await db.payments.orderBy('id').toArray();
    expect(payments.map((p) => [p.method_code, p.amount_paisa, p.reference])).toEqual([
      ['jazzcash', 10000, 'TX77'],
      ['cash', 11500, null],
    ]);
  });

  it('a wallet cannot pay more than is due; disabled methods are not offered', async () => {
    await seedShop();
    await db.payment_methods.update(method('easypaisa', '', 3).id, { active: false });
    putTomatoes();
    renderAt('/sale/pay');
    await screen.findByRole('button', { name: 'JazzCash' });
    expect(screen.queryByRole('button', { name: 'Easypaisa' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'JazzCash' }));
    pressAmount('0'); // 215 → 2150
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    expect(
      await screen.findByText('This method cannot pay more than what is left.'),
    ).toBeInTheDocument();
    expect(await db.payments.count()).toBe(0);
  });

  it('works fully offline, end to end, and says so', async () => {
    await seedShop();
    setOnline(false);
    const { router } = renderAt('/sale');
    const tomato = (await screen.findByText('Tomato')).closest('button')!;
    await waitFor(() => expect(tomato).toBeEnabled());
    fireEvent.click(tomato);
    fireEvent.click(within(panel()).getByRole('button', { name: '1 kg' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Charge' }));
    // Opening the pay screen can take over a second when every package's tests run at once.
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale/pay'), {
      timeout: 5000,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Exact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findByText('Saved offline — will sync when online')).toBeInTheDocument();
    expect(await db.sales.count()).toBe(1);
    for (const fn of Object.values(vi.mocked(api))) expect(fn).not.toHaveBeenCalled();
  });

  it('F2 on the sale screen opens payment', async () => {
    await seedShop();
    putTomatoes();
    const { router } = renderAt('/sale');
    await screen.findByRole('button', { name: 'Charge' });
    fireEvent.keyDown(window, { key: 'F2' });
    // Charge reads the seller from Dexie first; slow when every package's tests run at once.
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale/pay'), {
      timeout: 5000,
    });
  });

  it('shows the reminder toast after the sale when sync is behind, at most once per 30 minutes', async () => {
    await seedShop();
    await db.outbox.add({
      id: '019a9b8e-0000-7000-8000-00000000aaa1',
      table: 'staff',
      op: 'upsert',
      row: { ...staffRow() },
      row_key: 'staff:old',
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      attempts: 0,
      actor_staff_id: STAFF_ID,
    });
    putTomatoes();
    const sale = await completeSale([
      { method_code: 'cash', amount_paisa: 21500, reference: null },
    ]);
    renderAt(`/sale/done/${sale.sale.id}`);
    expect(
      await screen.findByText(/not synced\. Connect to internet and tap Sync now\./),
    ).toBeInTheDocument();
    cleanup();
    renderAt(`/sale/done/${sale.sale.id}`);
    await screen.findByText('A1-000001');
    expect(screen.queryAllByText(/Connect to internet and tap Sync now\./)).toHaveLength(1); // the first toast only
  });
});

describe("today's sales (US018 remainder)", () => {
  async function twoSales() {
    await seedShop('shop');
    putTomatoes();
    await completeSale([{ method_code: 'cash', amount_paisa: 21500, reference: null }]); // by the owner
    await writeCurrentStaffId(CASHIER);
    putTomatoes();
    return completeSale([{ method_code: 'cash', amount_paisa: 21500, reference: null }]); // by the cashier
  }

  it('owners see every sale today', async () => {
    await twoSales();
    await writeCurrentStaffId(STAFF_ID);
    renderAt('/sales');
    expect(await screen.findByText('2 sales')).toBeInTheDocument();
    expect(screen.getByText('A1-000001')).toBeInTheDocument();
    expect(screen.getByText('A1-000002')).toBeInTheDocument();
  });

  it('a cashier sees only their own, and cannot open someone else’s', async () => {
    const mine = await twoSales();
    const others = (await db.sales.toArray()).find((s) => s.id !== mine.sale.id)!;
    renderAt('/sales');
    expect(await screen.findByText('1 sale')).toBeInTheDocument();
    expect(screen.getByText('A1-000002')).toBeInTheDocument();
    expect(screen.queryByText('A1-000001')).toBeNull();
    fireEvent.click(screen.getByText('A1-000002'));
    expect(await screen.findByRole('heading', { name: 'A1-000002' })).toBeInTheDocument();
    cleanup();
    renderAt(`/sales/${others.id}`);
    expect(await screen.findByText('This sale is not on this device.')).toBeInTheDocument();
  });
});
