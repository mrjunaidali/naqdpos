import { describe, expect, it } from 'vitest';
import {
  assertQtyMilli,
  formatQty,
  isQtyMilli,
  parseQty,
  priceForQty,
  unitsToQtyMilli,
} from './qty.ts';

describe('parseQty', () => {
  it.each([
    ['1.5', 1500],
    ['0.25', 250],
    ['0.125', 125],
    ['3', 3000],
    ['.75', 750],
    ['-0.5', -500],
  ])('parses %j as %i milli', (input, expected) => {
    expect(parseQty(input)).toBe(expected);
  });

  it.each(['', 'kg', '1.2345', '1/2'])('rejects %j', (input) => {
    expect(() => parseQty(input)).toThrow(RangeError);
  });
});

describe('unitsToQtyMilli', () => {
  it('multiplies whole units by 1000', () => {
    expect(unitsToQtyMilli(12)).toBe(12000);
    expect(() => unitsToQtyMilli(0.5)).toThrow(RangeError);
  });
});

describe('formatQty', () => {
  it.each([
    [1500, '1.5'],
    [2000, '2'],
    [125, '0.125'],
    [250, '0.25'],
    [0, '0'],
    [-500, '-0.5'],
    [10000, '10'],
  ])('formats %i as %j', (milli, expected) => {
    expect(formatQty(milli)).toBe(expected);
  });

  it('round-trips with parseQty', () => {
    for (const milli of [0, 1, 999, 1000, 1500, 123456, -42]) {
      expect(parseQty(formatQty(milli))).toBe(milli);
    }
  });
});

describe('priceForQty', () => {
  it('multiplies quantity by unit price', () => {
    // 1.5 kg at Rs 240/kg = Rs 360
    expect(priceForQty(1500, 24000)).toBe(36000);
    // 12 pieces at Rs 15 = Rs 180
    expect(priceForQty(12000, 1500)).toBe(18000);
  });

  it('rounds half away from zero to whole paisa', () => {
    // 0.333 kg at Rs 1.50/kg = 49.95 paisa → 50
    expect(priceForQty(333, 150)).toBe(50);
    // 0.001 kg at Rs 5/kg = 0.5 paisa → 1
    expect(priceForQty(1, 500)).toBe(1);
    // 0.001 kg at Rs 4.99/kg = 0.499 paisa → 0
    expect(priceForQty(1, 499)).toBe(0);
    // negative quantities (returns) mirror positive rounding
    expect(priceForQty(-1, 500)).toBe(-1);
    expect(priceForQty(-333, 150)).toBe(-50);
  });

  it('stays exact for large values where float multiplication would lose precision', () => {
    // 9,000,000 kg × Rs 1,000,000.01 — the intermediate product exceeds 2^53.
    expect(priceForQty(9_000_000_000, 100_000_001)).toBe(900_000_009_000_000);
  });

  it('rejects non-integer inputs and overflowing results', () => {
    expect(() => priceForQty(1.5, 100)).toThrow(RangeError);
    expect(() => priceForQty(1000, 1.5)).toThrow(RangeError);
    expect(() => priceForQty(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});

describe('isQtyMilli / assertQtyMilli', () => {
  it('accepts safe integers only', () => {
    expect(isQtyMilli(1500)).toBe(true);
    expect(isQtyMilli(1.5)).toBe(false);
    expect(() => assertQtyMilli(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
