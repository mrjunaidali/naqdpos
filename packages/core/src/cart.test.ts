import { describe, expect, it } from 'vitest';
import {
  cartTotals,
  isLineError,
  makeAmountLine,
  makeLine,
  MAX_LINE_QTY_MILLI,
  parseQtyInput,
  qtyForAmount,
  qtyLabel,
  UNIT_RULES,
  type CartLine,
  type LineSource,
} from './cart.ts';

const tomato: LineSource = {
  product_id: 'p-tomato',
  name: 'Tomato',
  name_ur: 'ٹماٹر',
  unit: 'kg',
  icon: '🍅',
  unit_price_paisa: 16000, // Rs 160/kg
};
const line = (source: LineSource, qty: number) => {
  const l = makeLine(source, qty, 'id');
  if (isLineError(l)) throw new Error(l.error);
  return l;
};

describe('lines by quantity', () => {
  it('kg: 1.5 kg at Rs 160 = Rs 240', () => {
    expect(line(tomato, 1500)).toMatchObject({
      qty_milli: 1500,
      unit_price_paisa: 16000,
      line_total_paisa: 24000,
      by_amount: false,
      is_custom: false,
    });
  });

  it('rounds half away from zero to whole paisa (1.3 kg × Rs 165 = Rs 214.50)', () => {
    expect(line({ ...tomato, unit_price_paisa: 16500 }, 1300).line_total_paisa).toBe(21450);
    // 0.005 kg × Rs 1.01 = 0.505 paisa → 1 paisa; 0.004 kg → 0.404 → 0
    expect(line({ ...tomato, unit_price_paisa: 101 }, 5).line_total_paisa).toBe(1);
    expect(line({ ...tomato, unit_price_paisa: 101 }, 4).line_total_paisa).toBe(0);
  });

  it('dozen with decimals and piece in whole units', () => {
    const banana = { ...tomato, unit: 'dozen' as const, unit_price_paisa: 24000 };
    expect(line(banana, 500).line_total_paisa).toBe(12000); // ½ dozen
    expect(line(banana, 1250).line_total_paisa).toBe(30000);
    const coconut = { ...tomato, unit: 'piece' as const, unit_price_paisa: 25000 };
    expect(line(coconut, 6000).line_total_paisa).toBe(150000);
  });

  it('refuses zero, negative and oversize quantities', () => {
    expect(makeLine(tomato, 0)).toEqual({ error: 'invalid_qty' });
    expect(makeLine(tomato, -5)).toEqual({ error: 'invalid_qty' });
    expect(makeLine(tomato, MAX_LINE_QTY_MILLI + 1)).toEqual({ error: 'too_large' });
  });

  it('a custom item has no product and is flagged', () => {
    const custom = line({ ...tomato, product_id: null, name: 'Basket', unit: 'piece' }, 2000);
    expect(custom).toMatchObject({ product_id: null, is_custom: true, line_total_paisa: 32000 });
  });
});

describe('by amount: the typed amount is the line total', () => {
  it('Rs 50 at Rs 160/kg → 315 g (312.5 rounded half up to 5 g), total exactly Rs 50', () => {
    const l = makeAmountLine(tomato, 5000, 'id');
    expect(l).toMatchObject({
      qty_milli: 315,
      unit_price_paisa: 16000,
      line_total_paisa: 5000,
      by_amount: true,
    });
  });

  it('Rs 100 at Rs 160/kg → 625 g exactly', () => {
    expect(qtyForAmount(10000, 16000)).toBe(625);
  });

  it('rounds to the nearest 5 g, half up', () => {
    expect(qtyForAmount(10000, 30000)).toBe(335); // 333.33 → 335
    expect(qtyForAmount(10000, 31000)).toBe(325); // 322.58 → 325
    expect(qtyForAmount(2000, 16000)).toBe(125); // 125 exactly
    expect(qtyForAmount(1000, 16000)).toBe(65); // 62.5 → 65
    expect(qtyForAmount(100, 16000)).toBe(5); // 6.25 → 5
  });

  it('refuses a missing rate (Rs 100 at Rs 0) and amounts too small for 5 g', () => {
    expect(makeAmountLine({ ...tomato, unit_price_paisa: 0 }, 10000)).toEqual({
      error: 'rate_needed',
    });
    expect(() => qtyForAmount(10000, 0)).toThrow();
    expect(makeAmountLine(tomato, 1)).toEqual({ error: 'amount_too_small' }); // 0.06 g
    expect(makeAmountLine(tomato, 0)).toEqual({ error: 'amount_too_small' });
  });

  it('large values stay exact (no float error)', () => {
    // Rs 9,999,999.99 at Rs 1,234.57/kg: exact BigInt result
    const qty = qtyForAmount(999_999_999, 123_457);
    const exact = ((999_999_999n * 1000n * 2n + 123_457n * 5n) / (123_457n * 5n * 2n)) * 5n;
    expect(BigInt(qty)).toBe(exact);
    expect(makeAmountLine(tomato, 999_999_999)).toEqual({ error: 'too_large' });
  });
});

describe('keypad input per unit', () => {
  it('kg and litre take up to 3 decimals', () => {
    expect(parseQtyInput('1.5', 'kg')).toEqual({ qty_milli: 1500 });
    expect(parseQtyInput('0.125', 'litre')).toEqual({ qty_milli: 125 });
    expect(parseQtyInput('0.1255', 'kg')).toEqual({ error: 'too_many_decimals' });
  });

  it('dozen takes decimals; piece and bundle whole numbers; g whole grams', () => {
    expect(parseQtyInput('0.5', 'dozen')).toEqual({ qty_milli: 500 });
    expect(parseQtyInput('2', 'piece')).toEqual({ qty_milli: 2000 });
    expect(parseQtyInput('1.5', 'piece')).toEqual({ error: 'too_many_decimals' });
    expect(parseQtyInput('2.5', 'bundle')).toEqual({ error: 'too_many_decimals' });
    expect(parseQtyInput('250', 'g')).toEqual({ qty_milli: 250_000 });
  });

  it('refuses empty, zero, junk and over 9,999 units', () => {
    for (const bad of ['', '.', 'abc', '1,5', '-1']) {
      expect(parseQtyInput(bad, 'kg'), bad).toEqual({ error: 'invalid' });
    }
    expect(parseQtyInput('0', 'kg')).toEqual({ error: 'zero' });
    expect(parseQtyInput('15000', 'kg')).toEqual({ error: 'too_large' });
    expect(parseQtyInput('9999', 'kg')).toEqual({ qty_milli: 9_999_000 });
  });

  it('has the quick buttons per unit', () => {
    expect(UNIT_RULES.kg.quick).toEqual([250, 500, 1000, 1500]);
    expect(UNIT_RULES.dozen.quick).toEqual([500, 1000, 2000, 3000]);
    expect(UNIT_RULES.piece.quick).toEqual([1000, 2000, 6000, 12000]);
    expect(UNIT_RULES.bundle.quick).toEqual([1000, 2000, 3000, 5000]);
    expect(UNIT_RULES.g.quick).toEqual([]);
    expect(UNIT_RULES.kg.byAmount && UNIT_RULES.litre.byAmount).toBe(true);
    expect(UNIT_RULES.dozen.byAmount || UNIT_RULES.piece.byAmount).toBe(false);
  });
});

describe('cartTotals', () => {
  it('sums line totals in paisa; counts lines', () => {
    const lines: CartLine[] = [
      line(tomato, 1500), // 24000
      line({ ...tomato, unit_price_paisa: 16500 }, 1300), // 21450
      makeAmountLine(tomato, 5000) as CartLine, // 5000
    ];
    expect(cartTotals(lines)).toEqual({ itemCount: 3, subtotal_paisa: 50450, total_paisa: 50450 });
    expect(cartTotals([])).toEqual({ itemCount: 0, subtotal_paisa: 0, total_paisa: 0 });
  });
});

describe('qtyLabel', () => {
  it('uses grams / ml below 1 kg / 1 litre, ½ dozen, shortest numbers', () => {
    expect(qtyLabel(250, 'kg')).toEqual({ amount: '250', unit: 'g' });
    expect(qtyLabel(1500, 'kg')).toEqual({ amount: '1.5', unit: 'kg' });
    expect(qtyLabel(1000, 'kg')).toEqual({ amount: '1', unit: 'kg' });
    expect(qtyLabel(750, 'litre')).toEqual({ amount: '750', unit: 'ml' });
    expect(qtyLabel(500, 'dozen')).toEqual({ amount: '½', unit: 'dozen' });
    expect(qtyLabel(1500, 'dozen')).toEqual({ amount: '1.5', unit: 'dozen' });
    expect(qtyLabel(6000, 'piece')).toEqual({ amount: '6', unit: 'piece' });
    expect(qtyLabel(250_000, 'g')).toEqual({ amount: '250', unit: 'g' });
  });
});
