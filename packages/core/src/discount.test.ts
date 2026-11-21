import { describe, expect, it } from 'vitest';
import { FocRuleSchema } from './api/schemas.ts';
import { makeLine, normalizeCartLine, type CartLine } from './cart.ts';
import type { ProductRow } from './catalogue.ts';
import {
  approvalCovers,
  checkDiscount,
  computeBill,
  focSuggestions,
  giveAway,
  lineNet,
  pctOfPaisa,
  suggestedFocRule,
  withinLimit,
} from './discount.ts';
import { buildSale } from './sale.ts';

const source = (over: Partial<Parameters<typeof makeLine>[0]> = {}) => ({
  product_id: 'p-tomato',
  name: 'Tomato',
  name_ur: null,
  unit: 'kg' as const,
  icon: null,
  unit_price_paisa: 16500,
  ...over,
});
/** 1.3 kg tomatoes at Rs 165 = Rs 214.50. */
const tomato = (over: Partial<CartLine> = {}): CartLine => ({
  ...(makeLine(source(), 1300) as CartLine),
  ...over,
});
/** 1 bundle coriander at Rs 40. */
const coriander = (over: Partial<CartLine> = {}): CartLine => ({
  ...(makeLine(
    source({ product_id: 'p-cor', name: 'Coriander', unit: 'bundle', unit_price_paisa: 4000 }),
    1000,
  ) as CartLine),
  ...over,
});

describe('percent to paisa', () => {
  it('is half up on whole paisa', () => {
    expect(pctOfPaisa(21455, 10)).toBe(2146); // 2145.5
    expect(pctOfPaisa(21454, 10)).toBe(2145); // 2145.4
    expect(pctOfPaisa(21450, 100)).toBe(21450);
    expect(pctOfPaisa(0, 50)).toBe(0);
  });

  it('accepts whole percent 1–100 only', () => {
    expect(checkDiscount(10000, { kind: 'pct', value: 0 })).toBe('bad_discount');
    expect(checkDiscount(10000, { kind: 'pct', value: 101 })).toBe('bad_discount');
    expect(checkDiscount(10000, { kind: 'pct', value: 12.5 })).toBe('bad_discount');
    expect(checkDiscount(10000, { kind: 'pct', value: 100 })).toBeNull();
    expect(checkDiscount(10000, { kind: 'rs', value: 0 })).toBe('bad_discount');
  });

  it('refuses a discount larger than what it applies to (nothing goes negative)', () => {
    expect(checkDiscount(10000, { kind: 'rs', value: 10001 })).toBe('too_much');
    expect(checkDiscount(10000, { kind: 'rs', value: 10000 })).toBeNull();
  });
});

describe('order of calculation', () => {
  it('line totals → line discounts → bill discount → rounding → total', () => {
    // 21450 − 10% (2145) = 19305; − Rs 5 bill = 18805; rounds down 5 paisa → Rs 188
    const bill = computeBill([tomato({ discount: { kind: 'pct', value: 10 } })], {
      kind: 'rs',
      value: 500,
    });
    expect(bill).toEqual({
      gross_paisa: 21450,
      line_discount_paisa: 2145,
      foc_value_paisa: 0,
      subtotal_paisa: 19305,
      discount_paisa: 500,
      rounding_paisa: -5,
      total_paisa: 18800,
      give_away_paisa: 2645,
    });
  });

  it('a bill % applies to the subtotal after line discounts, then rounds', () => {
    // 21450 − Rs 50 = 21400; 5% = 1070 → 20330 → rounds down to Rs 203
    const bill = computeBill([tomato({ discount: { kind: 'rs', value: 5000 } })], {
      kind: 'pct',
      value: 5,
    });
    expect([bill.subtotal_paisa, bill.discount_paisa, bill.total_paisa]).toEqual([
      16450, 823, 15600,
    ]);
  });

  it('never goes negative: a discount shrinks with its line', () => {
    const line = tomato({
      qty_milli: 100,
      line_total_paisa: 1650,
      discount: { kind: 'rs', value: 5000 },
    });
    expect(lineNet(line)).toBe(0);
    const bill = computeBill([line], { kind: 'rs', value: 10000 });
    expect([bill.subtotal_paisa, bill.discount_paisa, bill.total_paisa]).toEqual([0, 0, 0]);
  });

  it('a free line is 0 to pay, its value is kept, and a discount on it is ignored', () => {
    const bill = computeBill([
      tomato(),
      coriander({ is_foc: true, discount: { kind: 'rs', value: 1000 } }),
    ]);
    expect(lineNet(coriander({ is_foc: true }))).toBe(0);
    expect([bill.gross_paisa, bill.foc_value_paisa, bill.subtotal_paisa]).toEqual([
      21450, 4000, 21450,
    ]);
  });

  it('old stored cart lines get the new fields', () => {
    const old: Partial<CartLine> = { ...tomato() };
    delete old.is_foc;
    delete old.discount;
    expect(normalizeCartLine(old as CartLine)).toMatchObject({ is_foc: false, discount: null });
  });
});

describe('cashier give-away limit', () => {
  it('counts line discounts, the bill discount and the free value; base = paid lines', () => {
    const lines = [tomato({ discount: { kind: 'rs', value: 1000 } }), coriander({ is_foc: true })];
    expect(giveAway(lines, { kind: 'rs', value: 450 })).toEqual({
      give_away_paisa: 1000 + 450 + 4000,
      base_paisa: 21450,
    });
  });

  it('a cashier within the limit passes, above it does not; the owner has no limit', () => {
    // 10% of 21450 = 2145
    expect(withinLimit('cashier', { give_away_paisa: 2145, base_paisa: 21450 }, 10)).toBe(true);
    expect(withinLimit('cashier', { give_away_paisa: 2146, base_paisa: 21450 }, 10)).toBe(false);
    expect(withinLimit('owner', { give_away_paisa: 21450, base_paisa: 21450 }, 0)).toBe(true);
    expect(withinLimit('cashier', { give_away_paisa: 0, base_paisa: 0 }, 0)).toBe(true);
    // Only free items: nothing paid, so any give-away is above the limit.
    expect(withinLimit('cashier', { give_away_paisa: 4000, base_paisa: 0 }, 10)).toBe(false);
    expect(withinLimit(null, { give_away_paisa: 1, base_paisa: 100 }, 100)).toBe(false);
  });

  it('an approval covers up to the amount the owner saw', () => {
    expect(approvalCovers({ staffId: 'o', give_away_paisa: 5000 }, 5000)).toBe(true);
    expect(approvalCovers({ staffId: 'o', give_away_paisa: 5000 }, 5001)).toBe(false);
    expect(approvalCovers(null, 1)).toBe(false);
  });
});

describe('buildSale with discounts and free items', () => {
  const ctx = {
    shopId: 's1',
    deviceId: 'd1',
    staffId: 'st1',
    role: 'cashier' as const,
    limitPct: 10,
    receiptNo: 'A2-000001',
    now: new Date('2026-11-21T10:00:00.000Z'),
  };
  const cash = (amount: number) => [{ method_code: 'cash', amount_paisa: amount, reference: null }];

  it('stores line discounts, free lines and the bill discount consistently', () => {
    const lines = [tomato({ discount: { kind: 'rs', value: 1000 } }), coriander({ is_foc: true })];
    // give-away 1000 + 4000 = 5000 > 2145: needs the owner
    const rows = buildSale(lines, cash(20000), {
      ...ctx,
      billDiscount: { kind: 'rs', value: 450 },
      approval: { staffId: 'owner-1', give_away_paisa: 5450 },
    });
    if ('error' in rows) throw new Error(rows.error);
    expect(
      rows.lines.map((l) => [l.line_total_paisa, l.discount_paisa, l.is_foc, l.unit_price_paisa]),
    ).toEqual([
      [20450, 1000, false, 16500],
      [0, 0, true, 4000],
    ]);
    expect(rows.sale).toMatchObject({
      subtotal_paisa: 20450,
      discount_paisa: 450,
      rounding_paisa: 0,
      total_paisa: 20000,
      discount_approved_by_staff_id: 'owner-1',
    });
    expect(rows.sale.subtotal_paisa).toBe(rows.lines.reduce((s, l) => s + l.line_total_paisa, 0));
  });

  it('refuses a cashier above the limit without an owner approval that covers it', () => {
    const lines = [tomato({ discount: { kind: 'rs', value: 3000 } })]; // 3000 > 2145
    expect(buildSale(lines, cash(18500), ctx)).toEqual({ error: 'over_limit' });
    expect(
      buildSale(lines, cash(18500), { ...ctx, approval: { staffId: 'o', give_away_paisa: 2999 } }),
    ).toEqual({ error: 'over_limit' });
  });

  it('within the limit records no approver; the owner is never limited', () => {
    const small = [tomato({ discount: { kind: 'rs', value: 2000 } })]; // 2000 ≤ 2145
    const rows = buildSale(small, cash(19500), {
      ...ctx,
      approval: { staffId: 'o', give_away_paisa: 9999 },
    });
    if ('error' in rows) throw new Error(rows.error);
    expect(rows.sale.discount_approved_by_staff_id).toBeNull();

    const big = [tomato({ discount: { kind: 'pct', value: 50 } })];
    const owner = buildSale(big, cash(10700), { ...ctx, role: 'owner', limitPct: 0 });
    expect('error' in owner).toBe(false);
  });
});

describe('free with purchase (foc_rule)', () => {
  const product = (over: Partial<ProductRow>): ProductRow => ({
    id: 'p-cor',
    shop_id: 's1',
    category_id: null,
    name: 'Coriander',
    name_ur: null,
    unit: 'bundle',
    sale_price_paisa: 4000,
    barcode: null,
    track_stock: false,
    min_qty_milli: null,
    is_combo: false,
    packaging_cost_paisa: 0,
    foc_rule: { min_bill_paisa: 20000, qty_milli: 1000 },
    search_terms: [],
    created_at: '',
    updated_at: '',
    deleted_at: null,
    device_id: null,
    server_seq: null,
    ...over,
  });

  it('suggests at the threshold, not below it, and not when already in the cart', () => {
    const cor = product({});
    expect(focSuggestions([tomato({ line_total_paisa: 19999 })], [cor])).toEqual([]);
    expect(focSuggestions([tomato({ line_total_paisa: 20000 })], [cor])).toEqual([
      { product: cor, qty_milli: 1000 },
    ]);
    expect(focSuggestions([tomato(), coriander()], [cor])).toEqual([]);
    // Line discounts count: Rs 214.50 − Rs 20 is below Rs 200.
    expect(focSuggestions([tomato({ discount: { kind: 'rs', value: 2000 } })], [cor])).toEqual([]);
  });

  it('skips hidden products and products without a rule; at most 3', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) => product({ id, name: id }));
    expect(
      focSuggestions(
        [tomato()],
        [...many, product({ id: 'h', deleted_at: 'x' }), product({ id: 'n', foc_rule: null })],
      ),
    ).toHaveLength(3);
    expect(focSuggestions([tomato()], [product({ deleted_at: 'x' })])).toEqual([]);
  });

  it('validates the rule shape', () => {
    expect(FocRuleSchema.safeParse({ min_bill_paisa: 20000, qty_milli: 1000 }).success).toBe(true);
    expect(FocRuleSchema.safeParse({ min_bill_paisa: 20000 }).success).toBe(false);
    expect(FocRuleSchema.safeParse({ min_bill_paisa: -1, qty_milli: 1000 }).success).toBe(false);
    expect(FocRuleSchema.safeParse({ min_bill_paisa: 0, qty_milli: 0 }).success).toBe(false);
    expect(FocRuleSchema.safeParse({ min_bill_paisa: 0, qty_milli: 1.5 }).success).toBe(false);
    expect(FocRuleSchema.safeParse({ min_bill_paisa: 0, qty_milli: 1, extra: 1 }).success).toBe(
      false,
    );
  });

  it('presets suggest Rs 200 and 1 bundle / 50 g', () => {
    expect(suggestedFocRule('bundle')).toEqual({ min_bill_paisa: 20000, qty_milli: 1000 });
    expect(suggestedFocRule('kg')).toEqual({ min_bill_paisa: 20000, qty_milli: 50 });
    expect(suggestedFocRule('g')).toEqual({ min_bill_paisa: 20000, qty_milli: 50000 });
  });
});
