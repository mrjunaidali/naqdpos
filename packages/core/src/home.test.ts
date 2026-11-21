import { describe, expect, it } from 'vitest';
import { businessDateFor } from './sale.ts';
import {
  lowStockCount,
  receivableTotal,
  recentActivity,
  sevenDayTrend,
  todayTotals,
} from './home.ts';

const sale = (
  id: string,
  date: string,
  staff: string,
  total: number,
  at = `${date}T10:00:00.000Z`,
) => ({
  id,
  business_date: date,
  staff_id: staff,
  total_paisa: total,
  created_at: at,
  receipt_no: `A1-${id}`,
  customer_id: null,
});
const pay = (saleId: string, method: string, amount: number) => ({
  sale_id: saleId,
  kind: 'sale' as const,
  method_code: method,
  amount_paisa: amount,
});

describe('todayTotals', () => {
  const sales = [
    sale('1', '2026-11-22', 'owner', 21_500),
    sale('2', '2026-11-22', 'cashier', 10_000),
    sale('3', '2026-11-21', 'owner', 5_000),
  ];
  const payments = [
    pay('1', 'cash', 11_500),
    pay('1', 'jazzcash', 5_000),
    pay('2', 'cash', 10_000),
    pay('3', 'cash', 5_000),
  ];
  const khata = [{ sale_id: '1', type: 'credit_sale' as const, amount_paisa: 5_000 }];

  it('splits cash, wallet / bank and khata for the business date', () => {
    expect(todayTotals(sales, payments, khata, { date: '2026-11-22' })).toEqual({
      total_paisa: 31_500,
      invoices: 2,
      cash_paisa: 21_500,
      other_paisa: 5_000,
      khata_paisa: 5_000,
    });
  });

  it('a cashier sees only their own sales', () => {
    expect(todayTotals(sales, payments, khata, { date: '2026-11-22', staffId: 'cashier' })).toEqual(
      {
        total_paisa: 10_000,
        invoices: 1,
        cash_paisa: 10_000,
        other_paisa: 0,
        khata_paisa: 0,
      },
    );
  });

  it('after a 21:00 close, a 21:30 sale belongs to the next business date', () => {
    const at2130 = new Date('2026-11-22T16:30:00Z');
    const date = businessDateFor(at2130, new Set(['2026-11-22']));
    expect(date).toBe('2026-11-23');
    const late = [sale('9', date, 'owner', 4_000)];
    expect(todayTotals(late, [pay('9', 'cash', 4_000)], [], { date }).total_paisa).toBe(4_000);
  });
});

describe('sevenDayTrend', () => {
  it('seven business dates ending today, gaps as 0, today marked', () => {
    const t = sevenDayTrend(
      [
        sale('1', '2026-11-22', 'o', 100),
        sale('2', '2026-11-20', 'o', 300),
        sale('3', '2026-11-10', 'o', 900),
      ],
      '2026-11-22',
    );
    expect(t.days.map((d) => d.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(t.days.map((d) => d.total_paisa)).toEqual([0, 0, 0, 0, 300, 0, 100]);
    expect(t.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-11-22']);
    expect(t.max_paisa).toBe(300);
  });
});

describe('receivable and low stock', () => {
  it('receivable counts positive balances only', () => {
    expect(
      receivableTotal([
        { customer_id: 'a', amount_paisa: 50_000 },
        { customer_id: 'a', amount_paisa: -10_000 },
        { customer_id: 'b', amount_paisa: -2_000 }, // advance: not receivable
        { customer_id: 'c', amount_paisa: 1_000 },
      ]),
    ).toBe(41_000);
  });

  it('low stock: tracked, not hidden, stock at or below zero', () => {
    const p = (id: string, track: boolean, hidden = false) => ({
      id,
      track_stock: track,
      deleted_at: hidden ? 'x' : null,
    });
    expect(
      lowStockCount(
        [
          p('none', true),
          p('neg', true),
          p('ok', true),
          p('untracked', false),
          p('hidden', true, true),
        ],
        [
          { product_id: 'neg', qty_milli: -500 },
          { product_id: 'ok', qty_milli: 2_000 },
        ],
      ),
    ).toBe(2);
  });
});

describe('recentActivity', () => {
  it('newest first, sales and khata entries, at most 5; a sale’s own credit entry not repeated', () => {
    const sales = [1, 2, 3, 4].map((i) =>
      sale(String(i), '2026-11-22', 'o', i * 100, `2026-11-22T0${i}:00:00.000Z`),
    );
    const khata = [
      {
        id: 'k1',
        created_at: '2026-11-22T05:00:00.000Z',
        amount_paisa: -500,
        type: 'payment' as const,
        customer_id: 'c',
      },
      {
        id: 'k2',
        created_at: '2026-11-22T06:00:00.000Z',
        amount_paisa: 400,
        type: 'credit_sale' as const,
        customer_id: 'c',
      },
    ];
    const items = recentActivity(sales, khata);
    expect(items.map((i) => i.id)).toEqual(['k1', '4', '3', '2', '1']);
  });
});
