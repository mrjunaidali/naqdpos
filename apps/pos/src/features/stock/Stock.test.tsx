import { makeLine, type CartLine, type ProductRow, type ProductUnit } from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { saveProduct } from '../catalogue/catalogueRepo.ts';
import { useCartStore } from '../sale/cartStore.ts';
import { completeSale } from '../sale/completeSale.ts';
import { currentStock, recordStockAction, StockNotRecorded } from './stockRepo.ts';

const sync = vi.hoisted(() => ({ syncNow: vi.fn(() => Promise.resolve('synced')) }));
vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({ syncEngine: sync }));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const CASH = [{ method_code: 'cash', amount_paisa: 0, reference: null }];

async function product(name: string, trackStock: boolean, unit: ProductUnit = 'kg') {
  const id = await saveProduct(
    null,
    {
      name,
      name_ur: null,
      unit,
      category_id: null,
      sale_price_paisa: 10000,
      cost_price_paisa: null,
      search_terms: [],
      track_stock: trackStock,
      icon: null,
    },
    STAFF_ID,
    false,
  );
  return (await db.products.get(id))!;
}

function putLine(p: ProductRow, qtyMilli: number) {
  const line = makeLine(
    {
      product_id: p.id,
      name: p.name,
      name_ur: null,
      unit: p.unit,
      icon: null,
      unit_price_paisa: p.sale_price_paisa,
    },
    qtyMilli,
  ) as CartLine;
  useCartStore.getState().put(line);
  return line;
}

/** Pay the whole (rounded) bill in cash. */
async function payInFull() {
  const total = useCartStore.getState().lines.reduce((s, l) => s + l.line_total_paisa, 0);
  const rounded = Math.round(total / 100) * 100;
  return completeSale([{ ...CASH[0]!, amount_paisa: rounded }]);
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

/** Types on the sheet's keypad, e.g. "12.5". */
function typeOnPad(sheet: HTMLElement, text: string) {
  for (const key of text) {
    fireEvent.click(
      within(sheet).getByRole('button', { name: key === '.' ? 'Decimal point' : key }),
    );
  }
}

beforeEach(async () => {
  resetApiMock();
  sync.syncNow.mockReset();
  sync.syncNow.mockResolvedValue('synced');
  setOnline(true);
  await resetDb();
  useCartStore.setState({ lines: [], ready: true });
  await seedReady('owner');
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await seedPin(CASHIER, '1234');
});

describe('stock on sale (US024)', () => {
  it('writes a sale movement for tracked products only, in the sale transaction', async () => {
    const tomato = await product('Tomato', true);
    const mint = await product('Mint', false);
    await db.outbox.clear();
    putLine(tomato, 1300);
    putLine(mint, 500);
    // A custom item (no product) never moves stock.
    useCartStore.getState().put(
      makeLine(
        {
          product_id: null,
          name: 'Bag',
          name_ur: null,
          unit: 'piece',
          icon: null,
          unit_price_paisa: 2000,
        },
        1000,
      ) as CartLine,
    );
    const { sale } = await payInFull();

    const movements = await db.stock_movements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      product_id: tomato.id,
      qty_milli: -1300,
      reason: 'sale',
      ref_id: sale.id,
      business_date: sale.business_date,
      staff_id: STAFF_ID,
    });
    // Pushed after the sale it refers to.
    const tables = (await db.outbox.orderBy('id').toArray()).map((e) => e.table);
    expect(tables.at(-1)).toBe('stock_movements');
    expect(tables.indexOf('sales')).toBeLessThan(tables.indexOf('stock_movements'));
    expect(Object.keys(movements[0]!).some((k) => k.includes('cost'))).toBe(false);
  });

  it('nothing is written when the sale fails, movements included', async () => {
    const tomato = await product('Tomato', true);
    await db.outbox.clear();
    putLine(tomato, 1000);
    const realAdd = db.outbox.add.bind(db.outbox);
    const spy = vi.spyOn(db.outbox, 'add');
    // sale, line, payment go through; the stock movement's outbox write fails
    spy
      .mockImplementationOnce(realAdd)
      .mockImplementationOnce(realAdd)
      .mockImplementationOnce(realAdd);
    spy.mockImplementationOnce((() =>
      Promise.reject(new Error('disk full'))) as unknown as typeof db.outbox.add);
    await expect(payInFull()).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await db.sales.count()).toBe(0);
    expect(await db.stock_movements.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('stock may go negative: the sale is not blocked, the product shows amber "check stock"', async () => {
    const tomato = await product('Tomato', true);
    putLine(tomato, 1300);
    await payInFull();
    expect(await currentStock(tomato.id)).toBe(-1300);

    renderAt('/products');
    const card = await screen.findByText('−1.3 kg · check stock');
    expect(card.className).toContain('text-warning');
  });

  it('the product list shows stock for tracked products only', async () => {
    const tomato = await product('Tomato', true);
    await product('Mint', false);
    await recordStockAction({
      action: 'stock_in',
      product: tomato,
      qtyMilli: 12500,
      staff: await db.staff.get(STAFF_ID),
    });
    renderAt('/products');
    expect(await screen.findByText('Stock 12.5 kg')).toBeInTheDocument();
    expect(screen.getAllByText(/^Stock /)).toHaveLength(1);
  });
});

describe('stock screen (US025)', () => {
  it('a cashier records damaged stock with a note, offline, through the outbox', async () => {
    const tomato = await product('Tomato', true);
    await db.outbox.clear();
    await writeCurrentStaffId(CASHIER);
    setOnline(false);
    renderAt('/stock');
    fireEvent.click(await screen.findByRole('button', { name: 'Wastage: Tomato' }));
    const sheet = await screen.findByRole('dialog', { name: 'Wastage — Tomato' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Damaged' }));
    typeOnPad(sheet, '0.5');
    fireEvent.change(within(sheet).getByLabelText('Note (optional)'), {
      target: { value: 'crate fell' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save wastage' }));

    await waitFor(async () => expect(await db.stock_movements.count()).toBe(1));
    expect((await db.stock_movements.toArray())[0]).toMatchObject({
      product_id: tomato.id,
      qty_milli: -500,
      reason: 'damaged',
      note: 'crate fell',
      staff_id: CASHIER,
      shop_id: SHOP_ID,
    });
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ table: 'stock_movements', actor_staff_id: CASHIER });
    expect(vi.mocked(api.syncPush)).not.toHaveBeenCalled();
    expect(await screen.findByText('−500 g')).toBeInTheDocument();
  });

  it('Stock in and Set stock ask a cashier for the owner PIN', async () => {
    await product('Tomato', true);
    await writeCurrentStaffId(CASHIER);
    renderAt('/stock');
    fireEvent.click(await screen.findByRole('button', { name: 'Stock in: Tomato' }));
    expect(await screen.findByText('Stock in and Set stock need the owner.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Stock in — Tomato' })).toBeNull();
  });

  it('a cashier actor cannot record stock in or a count (core rule, before any write)', async () => {
    const tomato = await product('Tomato', true);
    const cashier = await db.staff.get(CASHIER);
    for (const action of ['stock_in', 'set_stock'] as const) {
      await expect(
        recordStockAction({ action, product: tomato, qtyMilli: 1000, staff: cashier }),
      ).rejects.toEqual(new StockNotRecorded('forbidden'));
    }
    expect(await db.stock_movements.count()).toBe(0);
  });

  it('the owner adds stock', async () => {
    const tomato = await product('Tomato', true);
    await writeCurrentStaffId(STAFF_ID);
    renderAt('/stock');
    fireEvent.click(await screen.findByRole('button', { name: 'Stock in: Tomato' }));
    const sheet = await screen.findByRole('dialog', { name: 'Stock in — Tomato' });
    typeOnPad(sheet, '20');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add stock' }));
    await waitFor(async () => expect(await currentStock(tomato.id)).toBe(20000));
    expect((await db.stock_movements.toArray())[0]).toMatchObject({
      reason: 'purchase',
      staff_id: STAFF_ID,
    });
  });
});

describe('set stock (count)', () => {
  async function withStock(milli: number) {
    const tomato = await product('Tomato', true);
    await recordStockAction({
      action: 'stock_in',
      product: tomato,
      qtyMilli: milli,
      staff: await db.staff.get(STAFF_ID),
    });
    await writeCurrentStaffId(STAFF_ID);
    return tomato;
  }

  async function count(text: string) {
    renderAt('/stock');
    fireEvent.click(await screen.findByRole('button', { name: 'Set stock: Tomato' }));
    const sheet = await screen.findByRole('dialog', { name: 'Set stock (count) — Tomato' });
    typeOnPad(sheet, text);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save count' }));
    return sheet;
  }

  it('syncs first, then writes the difference and keeps the count in the note', async () => {
    const tomato = await withStock(14000);
    // Sync brings in another device's sale of 1 kg before the count is compared.
    sync.syncNow.mockImplementationOnce(async () => {
      await db.stock_movements.put({
        id: '019a9b8e-0000-7000-8000-0000000ee001',
        shop_id: SHOP_ID,
        product_id: tomato.id,
        business_date: '2026-11-22',
        qty_milli: -1000,
        reason: 'sale',
        ref_id: '019a9b8e-0000-7000-8000-0000000ee002',
        note: null,
        staff_id: CASHIER,
        created_at: new Date().toISOString(),
        device_id: '019a9b8e-0000-7000-8000-0000000ee003',
        server_seq: 99,
      });
      return 'synced';
    });
    await count('12.5');
    await waitFor(async () => expect(await currentStock(tomato.id)).toBe(12500));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    const correction = (await db.stock_movements.toArray()).find(
      (m) => m.reason === 'count_correction',
    );
    // 14 kg − 1 kg sold elsewhere = 13 kg; counted 12.5 kg → −0.5 kg
    expect(correction).toMatchObject({
      qty_milli: -500,
      note: 'counted 12.5 kg',
      staff_id: STAFF_ID,
    });
    expect(screen.queryByText('Other devices’ sales may be missing — count anyway?')).toBeNull();
  });

  it('offline: warns that other devices’ sales may be missing, and counts anyway', async () => {
    const tomato = await withStock(14000);
    setOnline(false);
    sync.syncNow.mockResolvedValue('offline');
    const sheet = await count('12.5');
    expect(
      await within(sheet).findByText('Other devices’ sales may be missing — count anyway?'),
    ).toBeInTheDocument();
    expect(await db.stock_movements.count()).toBe(1); // nothing written yet
    fireEvent.click(within(sheet).getByRole('button', { name: 'Count anyway' }));
    await waitFor(async () => expect(await currentStock(tomato.id)).toBe(12500));
    expect((await db.stock_movements.toArray()).at(-1)).toMatchObject({
      reason: 'count_correction',
      qty_milli: -1500,
      note: 'counted 12.5 kg',
    });
  });

  it('a failed sync can be cancelled: nothing is written', async () => {
    await withStock(14000);
    sync.syncNow.mockRejectedValue(new Error('network'));
    const sheet = await count('3');
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Cancel' }));
    expect(await db.stock_movements.count()).toBe(1);
  });

  it('a count equal to the stock writes nothing', async () => {
    await withStock(4000);
    await count('4');
    expect(
      await screen.findByText('The count matches the stock: nothing changed.'),
    ).toBeInTheDocument();
    expect(await db.stock_movements.count()).toBe(1);
  });
});
