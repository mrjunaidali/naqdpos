import { describe, expect, it } from 'vitest';
import { makeAmountLine, makeLine, type CartLine } from './cart.ts';
import {
  applyPayment,
  buildSale,
  businessDate,
  changeDue,
  receiptCounter,
  receiptNo,
  remainingDue,
  roundBill,
  type SaleRows,
} from './sale.ts';

describe('roundBill (nearest whole rupee, half up)', () => {
  it.each([
    [21450, 50, 21500], // Rs 214.50 → 215
    [21449, -49, 21400], // Rs 214.49 → 214
    [21451, 49, 21500],
    [21400, 0, 21400], // already whole
    [99, 1, 100],
    [49, -49, 0],
    [0, 0, 0],
  ])('%i paisa → rounding %i, total %i', (subtotal, rounding, total) => {
    expect(roundBill(subtotal)).toEqual({
      subtotal_paisa: subtotal,
      discount_paisa: 0,
      rounding_paisa: rounding,
      total_paisa: total,
    });
  });

  it('rounds after the discount', () => {
    expect(roundBill(21450, 1000)).toMatchObject({ rounding_paisa: 50, total_paisa: 20500 });
  });

  it('refuses a discount above the subtotal', () => {
    expect(() => roundBill(100, 200)).toThrow();
  });
});

describe('payments', () => {
  it('cash: change back, the row records only what was applied', () => {
    expect(applyPayment(21500, 'cash', 50000)).toEqual({
      payment: { method_code: 'cash', amount_paisa: 21500, reference: null, tendered_paisa: 50000 },
      change_paisa: 28500,
    });
    expect(applyPayment(21500, 'cash', 10000)).toMatchObject({
      payment: { amount_paisa: 10000 },
      change_paisa: 0,
    });
    expect(changeDue(1000, 1500)).toBe(0);
  });

  it('other methods cannot pay more than due', () => {
    expect(applyPayment(21500, 'jazzcash', 21600)).toEqual({ error: 'too_much' });
    expect(applyPayment(21500, 'jazzcash', 10000, 'TX123')).toEqual({
      payment: { method_code: 'jazzcash', amount_paisa: 10000, reference: 'TX123' },
      change_paisa: 0,
    });
  });

  it('refuses zero and nothing-due payments', () => {
    expect(applyPayment(21500, 'cash', 0)).toEqual({ error: 'zero' });
    expect(applyPayment(0, 'cash', 100)).toEqual({ error: 'nothing_due' });
  });

  it('split: remaining goes down to 0', () => {
    const split = [{ amount_paisa: 10000 }, { amount_paisa: 5000 }];
    expect(remainingDue(21500, split)).toBe(6500);
    expect(remainingDue(21500, [...split, { amount_paisa: 6500 }])).toBe(0);
  });
});

describe('businessDate (Asia/Karachi, UTC+5)', () => {
  it('turns over at Karachi midnight, which is 19:00 UTC', () => {
    expect(businessDate(Date.parse('2026-11-21T18:59:59.999Z'))).toBe('2026-11-21');
    expect(businessDate(Date.parse('2026-11-21T19:00:00.000Z'))).toBe('2026-11-22');
    expect(businessDate(Date.parse('2026-12-31T19:00:00.000Z'))).toBe('2027-01-01');
    expect(businessDate(Date.parse('2026-11-21T00:30:00.000Z'))).toBe('2026-11-21');
  });
});

describe('receipt numbers', () => {
  it('device code + 6-digit counter, growing past 999,999', () => {
    expect(receiptNo('A2', 1)).toBe('A2-000001');
    expect(receiptNo('B17', 123)).toBe('B17-000123');
    expect(receiptNo('A1', 1_234_567)).toBe('A1-1234567');
    expect(() => receiptNo('A1', 0)).toThrow();
  });

  it('reads the counter back for this device code only', () => {
    expect(receiptCounter('A2-000017', 'A2')).toBe(17);
    expect(receiptCounter('A12-000017', 'A2')).toBeNull();
    expect(receiptCounter('A2-17', 'A2')).toBeNull();
  });
});

describe('buildSale', () => {
  const tomato = {
    product_id: 'p1',
    name: 'Tomato',
    name_ur: 'ٹماٹر',
    unit: 'kg' as const,
    icon: '🍅',
    unit_price_paisa: 16500,
  };
  const cart: CartLine[] = [
    makeLine(tomato, 1300) as CartLine, // 214.50
    makeAmountLine({ ...tomato, unit_price_paisa: 16000 }, 5000) as CartLine, // exactly 50
  ];
  const ctx = {
    shopId: 's1',
    deviceId: 'd1',
    staffId: 'st1',
    receiptNo: 'A2-000001',
    now: new Date('2026-11-21T19:30:00.000Z'),
  };

  it('builds sale, lines and payments that add up', () => {
    const rows = buildSale(
      cart,
      [
        { method_code: 'cash', amount_paisa: 20000, reference: null },
        { method_code: 'jazzcash', amount_paisa: 6500, reference: ' TX9 ' },
      ],
      ctx,
    ) as SaleRows;
    expect(rows.sale).toMatchObject({
      receipt_no: 'A2-000001',
      business_date: '2026-11-22', // 00:30 in Karachi
      staff_id: 'st1',
      subtotal_paisa: 26450,
      rounding_paisa: 50,
      total_paisa: 26500,
    });
    expect(rows.lines.map((l) => [l.name_ur_snapshot, l.by_amount, l.line_total_paisa])).toEqual([
      ['ٹماٹر', false, 21450],
      ['ٹماٹر', true, 5000],
    ]);
    expect(rows.lines.every((l) => l.sale_id === rows.sale.id)).toBe(true);
    expect(rows.payments.map((p) => [p.kind, p.method_code, p.amount_paisa, p.reference])).toEqual([
      ['sale', 'cash', 20000, null],
      ['sale', 'jazzcash', 6500, 'TX9'],
    ]);
    // ids in creation order: sale, then lines, then payments (the outbox pushes in this order)
    const ids = [rows.sale.id, ...rows.lines.map((l) => l.id), ...rows.payments.map((p) => p.id)];
    expect([...ids].sort()).toEqual(ids);
  });

  it('refuses an empty cart, a short or an over payment', () => {
    expect(buildSale([], [], ctx)).toEqual({ error: 'empty_cart' });
    expect(
      buildSale(cart, [{ method_code: 'cash', amount_paisa: 100, reference: null }], ctx),
    ).toEqual({
      error: 'not_paid',
    });
    expect(
      buildSale(cart, [{ method_code: 'cash', amount_paisa: 99_999, reference: null }], ctx),
    ).toEqual({
      error: 'overpaid',
    });
    expect(
      buildSale(cart, [{ method_code: 'cash', amount_paisa: 0, reference: null }], ctx),
    ).toEqual({
      error: 'bad_payment',
    });
  });
});
