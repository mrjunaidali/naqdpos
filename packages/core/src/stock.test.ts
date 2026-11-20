import { describe, expect, it } from 'vitest';
import fixture from './fixtures/stock-movements.json' with { type: 'json' };
import { StockMovementRowSchema } from './api/schemas.ts';
import {
  buildSaleMovements,
  buildStockAction,
  canRecordStockReason,
  countNote,
  needsStockCheck,
  stockByProduct,
  stockOf,
  type StockContext,
  type StockMovementRow,
} from './stock.ts';

const SHOP = '019a9b8e-0000-7000-8000-000000000001';
const STAFF = '019a9b8e-0000-7000-8000-000000000002';
const DEVICE = '019a9b8e-0000-7000-8000-000000000003';
const TOMATO = '019a9b8e-0000-7000-8000-00000000a001';
const MINT = '019a9b8e-0000-7000-8000-00000000a003';
const SALE = '019a9b8e-0000-7000-8000-00000000b001';
// 19:30 UTC on 21 Nov is 00:30 on 22 Nov in Karachi.
const ctx: StockContext = {
  shopId: SHOP,
  deviceId: DEVICE,
  staffId: STAFF,
  now: new Date('2026-11-21T19:30:00.000Z'),
};

const fixtureMovements = fixture.movements.map((m) => ({
  product_id: fixture.products[m.product as keyof typeof fixture.products],
  qty_milli: m.qty_milli,
}));

describe('stock sums', () => {
  it('stock is the integer sum of movements; none = 0', () => {
    expect(stockOf([])).toBe(0);
    expect(stockOf([{ qty_milli: 1500 }, { qty_milli: -250 }])).toBe(1250);
  });

  it('stockByProduct matches the shared fixture (also used by the SQL view test)', () => {
    const totals = stockByProduct(fixtureMovements);
    for (const [name, expected] of Object.entries(fixture.expected)) {
      expect(totals.get(fixture.products[name as keyof typeof fixture.products]), name).toBe(
        expected,
      );
    }
    expect(totals.get('unknown')).toBeUndefined();
  });

  it('flags stock at or below zero for a check', () => {
    expect(needsStockCheck(0)).toBe(true);
    expect(needsStockCheck(-2001)).toBe(true);
    expect(needsStockCheck(1)).toBe(false);
  });
});

describe('sale movements', () => {
  const products = new Map([
    [TOMATO, { track_stock: true }],
    [MINT, { track_stock: false }],
  ]);

  it('one negative sale movement per tracked line; untracked and custom items none', () => {
    const rows = buildSaleMovements(
      [
        { sale_id: SALE, product_id: TOMATO, qty_milli: 1300 },
        { sale_id: SALE, product_id: MINT, qty_milli: 1000 },
        { sale_id: SALE, product_id: null, qty_milli: 1000 },
      ],
      products,
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      product_id: TOMATO,
      qty_milli: -1300,
      reason: 'sale',
      ref_id: SALE,
      business_date: '2026-11-22',
      staff_id: STAFF,
      device_id: DEVICE,
      note: null,
    });
    expect(StockMovementRowSchema.safeParse(rows[0]).success).toBe(true);
  });

  it('a product not on the device is not tracked', () => {
    expect(
      buildSaleMovements([{ sale_id: SALE, product_id: SALE, qty_milli: 10 }], products, ctx),
    ).toEqual([]);
  });

  it('carries no cost', () => {
    const [row] = buildSaleMovements(
      [{ sale_id: SALE, product_id: TOMATO, qty_milli: 1 }],
      products,
      ctx,
    );
    expect(Object.keys(row!).some((k) => k.includes('cost'))).toBe(false);
  });
});

describe('stock screen actions', () => {
  const base = { productId: TOMATO, unit: 'kg' as const, role: 'owner' as const };
  const row = (r: ReturnType<typeof buildStockAction>) => r as StockMovementRow;

  it('wastage and damaged are negative, with the note', () => {
    expect(
      row(buildStockAction({ ...base, action: 'wastage', qtyMilli: 500, note: ' rotten ' }, ctx)),
    ).toMatchObject({ qty_milli: -500, reason: 'wastage', note: 'rotten' });
    expect(
      row(buildStockAction({ ...base, action: 'damaged', qtyMilli: 1000, role: 'cashier' }, ctx)),
    ).toMatchObject({ qty_milli: -1000, reason: 'damaged', note: null });
  });

  it('stock in is a positive purchase', () => {
    expect(
      row(buildStockAction({ ...base, action: 'stock_in', qtyMilli: 20000 }, ctx)),
    ).toMatchObject({ qty_milli: 20000, reason: 'purchase', ref_id: null });
  });

  it('set stock writes counted − current and keeps the count in the note', () => {
    expect(
      row(
        buildStockAction(
          { ...base, action: 'set_stock', qtyMilli: 12500, currentMilli: 14000 },
          ctx,
        ),
      ),
    ).toMatchObject({ qty_milli: -1500, reason: 'count_correction', note: 'counted 12.5 kg' });
    expect(
      row(
        buildStockAction(
          { ...base, action: 'set_stock', qtyMilli: 3000, currentMilli: -2000 },
          ctx,
        ),
      ),
    ).toMatchObject({ qty_milli: 5000 });
    expect(countNote(0, 'piece')).toBe('counted 0 piece');
  });

  it('a count equal to the current stock writes nothing', () => {
    expect(
      buildStockAction({ ...base, action: 'set_stock', qtyMilli: 4000, currentMilli: 4000 }, ctx),
    ).toBeNull();
  });

  it('refuses stock in and set stock for a cashier; wastage is allowed', () => {
    const cashier = { ...base, role: 'cashier' as const };
    expect(buildStockAction({ ...cashier, action: 'stock_in', qtyMilli: 1000 }, ctx)).toEqual({
      error: 'forbidden',
    });
    expect(
      buildStockAction({ ...cashier, action: 'set_stock', qtyMilli: 1000, currentMilli: 0 }, ctx),
    ).toEqual({ error: 'forbidden' });
    expect(
      buildStockAction({ ...base, action: 'wastage', qtyMilli: 1, role: 'rider' }, ctx),
    ).toEqual({ error: 'forbidden' });
    expect(canRecordStockReason('cashier', 'wastage')).toBe(true);
    expect(canRecordStockReason('cashier', 'purchase')).toBe(false);
    expect(canRecordStockReason('cashier', 'count_correction')).toBe(false);
    expect(canRecordStockReason(null, 'sale')).toBe(false);
  });

  it('refuses zero or negative amounts and long notes', () => {
    expect(buildStockAction({ ...base, action: 'wastage', qtyMilli: 0 }, ctx)).toEqual({
      error: 'bad_qty',
    });
    expect(buildStockAction({ ...base, action: 'stock_in', qtyMilli: -5 }, ctx)).toEqual({
      error: 'bad_qty',
    });
    expect(
      buildStockAction({ ...base, action: 'wastage', qtyMilli: 5, note: 'x'.repeat(201) }, ctx),
    ).toEqual({ error: 'note_too_long' });
  });
});
