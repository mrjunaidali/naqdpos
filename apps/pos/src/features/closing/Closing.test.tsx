import {
  businessDate,
  FRESH_PRODUCE,
  makeLine,
  nextDate,
  type CartLine,
  type DayCloseRow,
  type PaymentRow,
  type SaleRow,
} from '@naqdpos/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import {
  DEVICE_ID,
  resetDb,
  seedPin,
  seedReady,
  SHOP_ID,
  STAFF_ID,
  staffRow,
} from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { createFromPresets } from '../catalogue/catalogueRepo.ts';
import { addExpense } from '../expenses/expenseRepo.ts';
import { useCartStore } from '../sale/cartStore.ts';
import { completeSale } from '../sale/completeSale.ts';
import { formatDate } from '../../i18n/format.ts';
import { i18n as i18nForDates } from '../../i18n/index.ts';
import { costsAt } from './closingData.ts';

/** A business date as the English UI shows it ("23 Nov 2026"). */
const shown = (iso: string) => formatDate(iso, i18nForDates.getFixedT('en'));

const sync = vi.hoisted(() => ({ syncNow: vi.fn(() => Promise.resolve('synced')) }));
vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({ syncEngine: sync }));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const COUNTER = '019a9b8e-0000-7000-8000-0000000000d9';
const RENT = '019a9b8e-0000-7000-8000-0000000000e1';
const TODAY = businessDate(new Date());
const YESTERDAY = businessDate(new Date(Date.now() - 86_400_000));
const DAY_BEFORE = businessDate(new Date(Date.now() - 2 * 86_400_000));

let n = 0;
const id = () => `019a9b8e-0000-7000-8000-${String(++n).padStart(12, '0')}`;

function close(date: string, over: Partial<DayCloseRow> = {}): DayCloseRow {
  return {
    id: id(),
    shop_id: SHOP_ID,
    business_date: date,
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
    ...over,
  };
}
async function sale(
  date: string,
  total: number,
  over: Partial<SaleRow> = {},
  pay: Partial<PaymentRow> = {},
) {
  const saleId = id();
  await db.sales.put({
    id: saleId,
    shop_id: SHOP_ID,
    receipt_no: `Z1-${String(n).padStart(6, '0')}`,
    business_date: date,
    staff_id: STAFF_ID,
    customer_id: null,
    order_type: 'walk_in',
    source: 'walk_in',
    subtotal_paisa: total,
    discount_paisa: 0,
    rounding_paisa: 0,
    total_paisa: total,
    note: null,
    discount_approved_by_staff_id: null,
    created_at: `${date}T10:00:00.000Z`,
    device_id: DEVICE_ID,
    server_seq: null,
    ...over,
  });
  await db.payments.put({
    id: id(),
    shop_id: SHOP_ID,
    business_date: date,
    kind: 'sale',
    sale_id: saleId,
    customer_id: null,
    method_code: 'cash',
    amount_paisa: total,
    reference: null,
    staff_id: STAFF_ID,
    created_at: over.created_at ?? `${date}T10:00:00.000Z`,
    device_id: over.device_id ?? DEVICE_ID,
    server_seq: over.server_seq ?? null,
    ...pay,
  });
}

async function seedShop(mode: 'owner' | 'shop' = 'owner') {
  await seedReady(mode);
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await writeCurrentStaffId(STAFF_ID);
  await db.expense_categories.put({
    id: RENT,
    shop_id: SHOP_ID,
    name: 'Rent',
    name_ur: null,
    i18n_key: 'expense.cat.rent',
    icon: null,
    sort: 1,
    archived_at: null,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    device_id: null,
    server_seq: 1,
  });
  await db.outbox.clear();
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

beforeEach(async () => {
  resetApiMock();
  sync.syncNow.mockReset();
  sync.syncNow.mockResolvedValue('synced');
  setOnline(true);
  await resetDb();
  useCartStore.setState({
    lines: [],
    billDiscount: null,
    approval: null,
    customerId: null,
    ready: true,
  });
});

describe('closing screen (US044, US067)', () => {
  it('asks a cashier for the owner PIN', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    renderAt('/closing');
    expect(await screen.findByRole('heading', { name: 'Owner PIN needed' })).toBeInTheDocument();
  });

  it('opening defaults to the last count minus the withdrawal; expected, count and difference', async () => {
    await seedShop();
    await db.day_closes.put(
      close(DAY_BEFORE, { counted_cash_paisa: 500_000, owner_withdrawal_paisa: 300_000 }),
    );
    await sale(TODAY, 21_500);
    renderAt('/closing');
    expect(await screen.findByLabelText('Opening cash (Rs)')).toHaveValue('2000');
    // expected = 2000 + 215
    expect(screen.getByText('Expected cash').closest('p')).toHaveTextContent('Rs 2,215');
    fireEvent.click(screen.getByRole('button', { name: 'Notes and coins' }));
    fireEvent.change(screen.getByLabelText('Number of Rs 1,000'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Number of Rs 100'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Number of Rs 10'), { target: { value: '1' } });
    expect(screen.getByText('Short')).toBeInTheDocument(); // 2210 counted
    fireEvent.change(screen.getByLabelText('Number of Rs 5'), { target: { value: '1' } });
    expect(await screen.findByText('Exact')).toBeInTheDocument();
  });

  it('closes offline with a warning recorded in the note, then shows the summary', async () => {
    await seedShop();
    sync.syncNow.mockResolvedValue('offline');
    await sale(TODAY, 21_500);
    await addExpense(
      { categoryId: RENT, amountPaisa: 1_500, methodCode: 'cash' },
      (await db.staff.get(STAFF_ID))!,
      null,
    );
    const { router } = renderAt('/closing');
    expect(
      await screen.findByText('Closing offline — totals from other devices may be missing.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Counted cash (Rs)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, close the day' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/closing/${TODAY}`));
    const [c] = await db.day_closes.toArray();
    expect(c).toMatchObject({
      business_date: TODAY,
      expected_cash_paisa: 20_000,
      counted_cash_paisa: 20_000,
      difference_paisa: 0,
    });
    expect(c?.note).toContain('Closing offline');
    expect((await db.outbox.toArray()).at(-1)).toMatchObject({
      table: 'day_closes',
      actor_staff_id: STAFF_ID,
    });
    expect(await screen.findByText('Sales (1)')).toBeInTheDocument();
    expect(
      screen.getByText('Waiting to sync — late rows can’t be checked yet'),
    ).toBeInTheDocument();
  });

  it('offers the oldest unclosed day with activity first', async () => {
    await seedShop();
    await sale(DAY_BEFORE, 1_000);
    await sale(TODAY, 1_000);
    renderAt('/closing');
    expect(
      await screen.findByRole('heading', { name: `Close day — ${shown(DAY_BEFORE)}` }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 days are open: close the oldest first.')).toBeInTheDocument();
  });
});

describe('after closing (roll-forward)', () => {
  it('a sale after the close counts for the next day, with a banner; so does an expense', async () => {
    await seedShop();
    await db.day_closes.put(close(TODAY));
    const tomato = FRESH_PRODUCE.find((p) => p.key === 'tomato')!;
    await createFromPresets([{ preset: tomato, rate: 16500 }], STAFF_ID);
    const p = (await db.products.toArray())[0]!;
    useCartStore.getState().put(
      makeLine(
        {
          product_id: p.id,
          name: p.name,
          name_ur: null,
          unit: 'kg',
          icon: null,
          unit_price_paisa: 16500,
        },
        1300,
      ) as CartLine,
    );
    const rows = await completeSale([
      { method_code: 'cash', amount_paisa: 21_500, reference: null },
    ]);
    expect(rows.sale.business_date).toBe(nextDate(TODAY));
    expect(rows.payments[0]!.business_date).toBe(nextDate(TODAY));
    const e = await addExpense(
      { categoryId: RENT, amountPaisa: 100, methodCode: 'cash' },
      (await db.staff.get(STAFF_ID))!,
      null,
    );
    expect(e.business_date).toBe(nextDate(TODAY));
    renderAt('/sale');
    expect(
      await screen.findByText(`Day closed — new sales count for ${shown(nextDate(TODAY))}`),
    ).toBeInTheDocument();
  });
});

describe('daily summary (US045)', () => {
  it('8 pm counter sale pushed at 10 pm after a 9 pm offline close: flagged, and the gap shown', async () => {
    await seedShop();
    const ninePm = `${TODAY}T16:00:00.000Z`;
    await db.day_closes.put(
      close(TODAY, {
        closed_at: ninePm,
        seen_through_seq: 100,
        server_seq: 130,
        expected_cash_paisa: 20_000,
        counted_cash_paisa: 20_000,
      }),
    );
    // This device's own sale before closing, not yet pushed: counted, not flagged.
    await sale(TODAY, 20_000, { created_at: `${TODAY}T10:00:00.000Z` });
    // The counter's 8 pm sale, pushed at 10 pm (server_seq above the cursor).
    await sale(
      TODAY,
      1_500,
      { created_at: `${TODAY}T15:00:00.000Z`, device_id: COUNTER, server_seq: 125 },
      { server_seq: 126 },
    );
    renderAt(`/closing/${TODAY}`);
    expect(
      await screen.findByText(
        'Not included at closing: Rs 15 (rows from other devices that synced later).',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Arrived after closing: 2')).toBeInTheDocument(); // the sale and its payment
    expect(screen.getByText('Expected cash now (all devices)')).toBeInTheDocument();
  });

  it('wastage value only on owner devices; WhatsApp text; history', async () => {
    await seedShop('owner');
    await db.products.put({
      id: 'p1',
      shop_id: SHOP_ID,
      category_id: null,
      name: 'Tomato',
      name_ur: null,
      unit: 'kg',
      sale_price_paisa: 16500,
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
    });
    await db.product_cost_history.put({
      id: id(),
      shop_id: SHOP_ID,
      product_id: 'p1',
      cost_price_paisa: 12_000,
      effective_at: `${YESTERDAY}T05:00:00.000Z`,
      created_at: '',
      device_id: null,
      server_seq: 2,
    });
    await db.stock_movements.put({
      id: id(),
      shop_id: SHOP_ID,
      product_id: 'p1',
      business_date: YESTERDAY,
      qty_milli: -500,
      reason: 'wastage',
      ref_id: null,
      note: null,
      staff_id: STAFF_ID,
      created_at: '',
      device_id: DEVICE_ID,
      server_seq: null,
    });
    await db.day_closes.put(close(YESTERDAY));
    renderAt(`/closing/${YESTERDAY}`);
    expect(await screen.findByText('Wastage value')).toBeInTheDocument();
    expect(screen.getByText('Rs 60')).toBeInTheDocument(); // 0.5 kg × Rs 120
    // A shop device holds no costs: the summary there shows quantities only.
    expect(await costsAt(YESTERDAY)).toBeInstanceOf(Map);
    await seedReady('shop');
    expect(await costsAt(YESTERDAY)).toBeUndefined();

    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Share on WhatsApp' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain(`Day summary ${shown(YESTERDAY)}`);
  });

  it('lists past closes', async () => {
    await seedShop();
    await db.day_closes.put(
      close(YESTERDAY, { difference_paisa: -500, counted_cash_paisa: 0, expected_cash_paisa: 500 }),
    );
    renderAt('/closing/history');
    expect(
      await screen.findByRole('link', { name: new RegExp(shown(YESTERDAY)) }),
    ).toBeInTheDocument();
  });
});
