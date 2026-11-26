import { describe, expect, it } from 'vitest';
import fixture from './fixtures/expected-cash.json' with { type: 'json' };
import {
  activityDates,
  buildDayClose,
  businessDateFor,
  closableDays,
  dailySummary,
  denominationTotal,
  expectedCash,
  openingDefault,
  rowsNotSeenAtClosing,
  sortSaleLines,
  type DayCloseRow,
  type SummaryInput,
} from './closing.ts';
import { receiptText } from './receipt.ts';
import type { PaymentRow } from './sale.ts';

const SHOP = '019a9b8e-0000-7000-8000-000000000001';
const OWNER = '019a9b8e-0000-7000-8000-000000000002';
const COUNTER = 'device-counter';
const OWNER_PHONE = 'device-owner';

describe('expected cash', () => {
  it('matches the shared fixture (also used by the SQL test)', () => {
    expect(
      expectedCash({
        openingPaisa: fixture.opening_paisa,
        payments: fixture.payments as Pick<PaymentRow, 'kind' | 'method_code' | 'amount_paisa'>[],
        expenses: fixture.expenses,
        withdrawalPaisa: fixture.withdrawal_paisa,
      }),
    ).toBe(fixture.expected_paisa);
  });

  it('opening default: last count minus what the owner took home; first close 0', () => {
    expect(openingDefault({ counted_cash_paisa: 500_000, owner_withdrawal_paisa: 300_000 })).toBe(
      200_000,
    );
    expect(openingDefault(null)).toBe(0);
  });
});

describe('business date after closing', () => {
  it('a sale at 21:30 after a 21:00 close counts for the next day', () => {
    const at2130 = new Date('2026-11-22T16:30:00Z'); // 21:30 Karachi
    expect(businessDateFor(at2130)).toBe('2026-11-22');
    expect(businessDateFor(at2130, new Set(['2026-11-22']))).toBe('2026-11-23');
    expect(businessDateFor(at2130, ['2026-11-21'])).toBe('2026-11-22');
  });

  it('offers the oldest unclosed day with activity first, never a future day', () => {
    const closed = new Set(['2026-11-20']);
    expect(
      closableDays(['2026-11-22', '2026-11-20', '2026-11-21', '2026-11-23'], closed, '2026-11-22'),
    ).toEqual(['2026-11-21', '2026-11-22']);
    expect(closableDays([], new Set(), '2026-11-22')).toEqual(['2026-11-22']);
    expect(closableDays([], new Set(['2026-11-22']), '2026-11-22')).toEqual([]);
  });
});

describe('counting and closing', () => {
  it('denomination totals', () => {
    expect(denominationTotal({ 500_000: 1, 100_000: 3, 1_000: 2, 100: 5 })).toBe(802_500);
    expect(denominationTotal({})).toBe(0);
    expect(() => denominationTotal({ 500: -1 })).toThrow(RangeError);
  });

  const ctx = {
    shopId: SHOP,
    deviceId: OWNER_PHONE,
    staffId: OWNER,
    role: 'owner' as const,
    now: new Date('2026-11-22T16:00:00Z'),
    closedDates: new Set<string>(),
  };
  const input = {
    businessDate: '2026-11-22',
    openingPaisa: 100_000,
    expectedPaisa: 141_500,
    countedPaisa: 141_000,
    withdrawalPaisa: 0,
    note: null,
    seenThroughSeq: 120,
  };

  it('the owner closes; difference = counted − expected', () => {
    expect(buildDayClose(input, ctx)).toMatchObject({
      difference_paisa: -500,
      closed_by_staff_id: OWNER,
      seen_through_seq: 120,
    });
  });

  it('refuses a cashier, a day closed twice and a future day', () => {
    expect(buildDayClose(input, { ...ctx, role: 'cashier' })).toEqual({ error: 'forbidden' });
    expect(buildDayClose(input, { ...ctx, closedDates: new Set(['2026-11-22']) })).toEqual({
      error: 'already_closed',
    });
    expect(buildDayClose({ ...input, businessDate: '2026-11-23' }, ctx)).toEqual({
      error: 'future',
    });
    expect(buildDayClose({ ...input, countedPaisa: -1 }, ctx)).toEqual({ error: 'bad_amount' });
  });
});

describe('rows not seen at closing', () => {
  // 8 pm the counter sells (pushed at 10 pm); 9 pm the owner phone closes offline (cursor 100).
  const close: DayCloseRow = {
    id: 'c',
    shop_id: SHOP,
    business_date: '2026-11-22',
    opening_cash_paisa: 0,
    expected_cash_paisa: 21_500,
    counted_cash_paisa: 21_500,
    difference_paisa: 0,
    owner_withdrawal_paisa: 0,
    note: null,
    closed_by_staff_id: OWNER,
    closed_at: '2026-11-22T16:00:00.000Z',
    seen_through_seq: 100,
    device_id: OWNER_PHONE,
    server_seq: 130,
  };
  const row = (device: string, created: string, seq: number | null) => ({
    device_id: device,
    created_at: created,
    server_seq: seq,
  });

  it("the counter's 8 pm sale pushed at 10 pm is flagged; the closing device's own pre-close sale is not", () => {
    const counter8pm = row(COUNTER, '2026-11-22T15:00:00.000Z', 125);
    const own = row(OWNER_PHONE, '2026-11-22T15:30:00.000Z', 140); // pushed after the close
    const seenBefore = row(COUNTER, '2026-11-22T10:00:00.000Z', 90);
    expect(rowsNotSeenAtClosing([counter8pm, own, seenBefore], close)).toEqual({
      status: 'checked',
      rows: [counter8pm],
    });
  });

  it('waits while the close or a row has no server_seq yet', () => {
    expect(rowsNotSeenAtClosing([], { ...close, server_seq: null })).toEqual({ status: 'waiting' });
    expect(rowsNotSeenAtClosing([row(COUNTER, '2026-11-22T15:00:00.000Z', null)], close)).toEqual({
      status: 'waiting',
    });
    // The closing device's own unsynced pre-close sale does not make it wait.
    expect(
      rowsNotSeenAtClosing([row(OWNER_PHONE, '2026-11-22T15:00:00.000Z', null)], close),
    ).toEqual({ status: 'checked', rows: [] });
  });
});

describe('daily summary', () => {
  const L = (key: string, vars: Record<string, string> = {}) =>
    ({
      'receipt.rs': `Rs ${vars.amount}`,
      'unit.kg': 'kg',
      'unit.g': 'g',
      'summary.title': `Day summary ${vars.date}`,
      'summary.sales': `Sales (${vars.count})`,
      'summary.discounts': 'Discounts',
      'summary.foc': 'Free items (value)',
      'summary.khataGiven': 'Khata given',
      'summary.khataReceived': 'Khata received',
      'summary.expenses': 'Expenses',
      'summary.wastage': 'Wastage',
      'summary.wastageValue': 'Wastage value',
      'summary.opening': 'Opening cash',
      'summary.withdrawal': 'Owner took home',
      'summary.expected': 'Expected cash',
      'summary.counted': 'Counted cash',
      'summary.short': 'Short',
      'summary.over': 'Over',
      'summary.exact': 'Exact',
      'summary.expectedNow': 'Expected cash now (all devices)',
      'summary.gap': 'Not included at closing',
      'summary.waiting': 'Waiting to sync — late rows can’t be checked yet',
      'summary.late': `Arrived after closing: ${vars.count}`,
      'summary.closedAt': `Closed ${vars.at}`,
    })[key] ?? key;

  const close: DayCloseRow = {
    id: 'c',
    shop_id: SHOP,
    business_date: '2026-11-22',
    opening_cash_paisa: 100_000,
    expected_cash_paisa: 121_500,
    counted_cash_paisa: 121_000,
    difference_paisa: -500,
    owner_withdrawal_paisa: 0,
    note: 'Closing offline',
    closed_by_staff_id: OWNER,
    closed_at: '2026-11-22T16:00:00.000Z',
    seen_through_seq: 100,
    device_id: OWNER_PHONE,
    server_seq: 130,
  };
  const pay = (
    id: string,
    kind: PaymentRow['kind'],
    method: string,
    amount: number,
    device: string,
    seq: number,
  ): PaymentRow => ({
    id,
    shop_id: SHOP,
    business_date: '2026-11-22',
    kind,
    sale_id: kind === 'sale' ? 's1' : null,
    customer_id: null,
    method_code: method,
    amount_paisa: amount,
    reference: null,
    staff_id: OWNER,
    created_at: '2026-11-22T15:00:00.000Z',
    device_id: device,
    server_seq: seq,
  });

  const base: SummaryInput = {
    close,
    sales: [
      {
        id: 's1',
        shop_id: SHOP,
        receipt_no: 'A1-000001',
        business_date: '2026-11-22',
        staff_id: OWNER,
        customer_id: null,
        order_type: 'walk_in',
        source: 'walk_in',
        subtotal_paisa: 20_450,
        discount_paisa: 450,
        rounding_paisa: 0,
        total_paisa: 20_000,
        note: null,
        discount_approved_by_staff_id: null,
        created_at: '2026-11-22T10:00:00.000Z',
        device_id: OWNER_PHONE,
        server_seq: 50,
      },
      {
        id: 's2',
        shop_id: SHOP,
        receipt_no: 'B1-000001',
        business_date: '2026-11-22',
        staff_id: OWNER,
        customer_id: null,
        order_type: 'walk_in',
        source: 'walk_in',
        subtotal_paisa: 1_500,
        discount_paisa: 0,
        rounding_paisa: 0,
        total_paisa: 1_500,
        note: null,
        discount_approved_by_staff_id: null,
        created_at: '2026-11-22T15:00:00.000Z',
        device_id: COUNTER,
        server_seq: 125,
      },
    ],
    lines: [
      {
        id: 'l1',
        shop_id: SHOP,
        sale_id: 's1',
        product_id: 'p1',
        name_snapshot: 'Tomato',
        name_ur_snapshot: null,
        unit_snapshot: 'kg',
        qty_milli: 1300,
        unit_price_paisa: 16_500,
        discount_paisa: 1_000,
        is_foc: false,
        by_amount: false,
        line_total_paisa: 20_450,
        created_at: '',
        device_id: null,
        server_seq: 51,
      },
      {
        id: 'l2',
        shop_id: SHOP,
        sale_id: 's1',
        product_id: 'p2',
        name_snapshot: 'Coriander',
        name_ur_snapshot: null,
        unit_snapshot: 'kg',
        qty_milli: 100,
        unit_price_paisa: 40_000,
        discount_paisa: 0,
        is_foc: true,
        by_amount: false,
        line_total_paisa: 0,
        created_at: '',
        device_id: null,
        server_seq: 52,
      },
    ],
    payments: [
      pay('p1', 'sale', 'cash', 20_000, OWNER_PHONE, 53),
      pay('p2', 'sale', 'cash', 1_500, COUNTER, 126), // the counter's 8 pm sale, pushed at 10 pm
      pay('p3', 'khata_receipt', 'cash', 1_500, OWNER_PHONE, 60),
    ],
    khata: [
      {
        id: 'k1',
        shop_id: SHOP,
        customer_id: 'c1',
        business_date: '2026-11-22',
        type: 'credit_sale',
        amount_paisa: 5_000,
        sale_id: 's9',
        payment_id: null,
        note: null,
        staff_id: OWNER,
        created_at: '',
        device_id: null,
        server_seq: 61,
      },
      {
        id: 'k2',
        shop_id: SHOP,
        customer_id: 'c1',
        business_date: '2026-11-22',
        type: 'payment',
        amount_paisa: -1_500,
        sale_id: null,
        payment_id: 'p3',
        note: null,
        staff_id: OWNER,
        created_at: '',
        device_id: null,
        server_seq: 62,
      },
    ],
    expenses: [],
    movements: [
      {
        id: 'm1',
        shop_id: SHOP,
        product_id: 'p1',
        business_date: '2026-11-22',
        qty_milli: -500,
        reason: 'wastage',
        ref_id: null,
        note: null,
        staff_id: OWNER,
        created_at: '',
        device_id: null,
        server_seq: 70,
      },
    ],
    products: new Map([['p1', { name: 'Tomato', unit: 'kg' }]]),
    categoryName: (id) => id,
    methodName: (code) => (code === 'cash' ? 'Cash' : code),
    label: L,
    shopName: 'Ali Fruit',
    paperWidthMm: 58,
    rtl: false,
  };

  it('has every section; the gap shows what closing did not include', () => {
    const s = dailySummary({ ...base, costs: new Map([['p1', 12_000]]) });
    const text = receiptText(s.doc);
    for (const part of [
      'Sales (2): Rs 215',
      '  Cash: Rs 215',
      'Discounts: Rs 14.50',
      'Free items (value): Rs 40',
      'Khata given: Rs 50',
      'Khata received: Rs 15',
      '  Tomato: 500 g',
      'Wastage value: Rs 60',
      '*Short: Rs 5*',
      'Expected cash now (all devices): Rs 1,230',
      '*Not included at closing: Rs 15*',
      '*Arrived after closing: 2: Rs 15*',
      'Closing offline',
    ]) {
      expect(text, part).toContain(part);
    }
    expect(s.gapPaisa).toBe(1_500);
    expect(s.late).toMatchObject({ status: 'checked', count: 2, cashPaisa: 1_500 });
  });

  it('wastage value only where costs are known (owner devices)', () => {
    const text = receiptText(dailySummary(base).doc);
    expect(text).toContain('  Tomato: 500 g');
    expect(text).not.toContain('Wastage value');
  });

  it('says it is waiting while the close has not synced', () => {
    const s = dailySummary({ ...base, close: { ...close, server_seq: null } });
    expect(s.late).toEqual({ status: 'waiting' });
    expect(receiptText(s.doc)).toContain('Waiting to sync');
  });
});

// Bug 2026-11-25: iOS WebKit refuses Dexie's orderBy().uniqueKeys(); the app dedupes in JS.
describe('activityDates', () => {
  it('is the distinct dates of all tables, oldest first, like uniqueKeys() on each index', () => {
    const sales = [{ business_date: '2026-11-23' }, { business_date: '2026-11-21' }];
    const payments = [{ business_date: '2026-11-21' }, { business_date: '2026-11-22' }];
    const expenses: { business_date: string }[] = [];
    expect(activityDates(sales, payments, expenses)).toEqual([
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
    ]);
  });

  it('skips rows without a string date (an index holds no such key)', () => {
    expect(activityDates([{ business_date: null }, {}, { business_date: '2026-11-20' }])).toEqual([
      '2026-11-20',
    ]);
    expect(activityDates()).toEqual([]);
  });

  it('feeds closableDays the same days as before', () => {
    const dates = activityDates([{ business_date: '2026-11-20' }, { business_date: '2026-11-21' }]);
    expect(closableDays(dates, new Set(['2026-11-20']), '2026-11-22')).toEqual(['2026-11-21']);
  });
});

describe('sortSaleLines', () => {
  it('orders by sale_id, then line id (the anyOf() order on the sale_id index)', () => {
    const lines = [
      { sale_id: 'b', id: '2' },
      { sale_id: 'a', id: '9' },
      { sale_id: 'b', id: '1' },
      { sale_id: 'a', id: '3' },
    ];
    expect(sortSaleLines(lines).map((l) => `${l.sale_id}${l.id}`)).toEqual([
      'a3',
      'a9',
      'b1',
      'b2',
    ]);
    expect(lines[0]).toEqual({ sale_id: 'b', id: '2' }); // input untouched
  });
});
