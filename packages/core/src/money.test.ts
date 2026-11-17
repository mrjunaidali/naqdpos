import { describe, expect, it } from 'vitest';
import {
  assertPaisa,
  isPaisa,
  paisaToRupeesString,
  rupeesToPaisa,
  sumPaisa,
  wholeRupeesToPaisa,
} from './money.ts';

describe('rupeesToPaisa', () => {
  it.each([
    ['120', 12000],
    ['120.5', 12050],
    ['120.50', 12050],
    ['0.01', 1],
    ['.5', 50],
    ['5.', 500],
    ['1,250.75', 125075],
    [' 42 ', 4200],
    ['-3.25', -325],
    ['+7', 700],
    ['-0', 0],
  ])('parses %j as %i paisa', (input, expected) => {
    expect(rupeesToPaisa(input)).toBe(expected);
  });

  it('never goes through floats (0.1 + 0.2 style inputs are exact)', () => {
    expect(rupeesToPaisa('0.29')).toBe(29);
    expect(rupeesToPaisa('1.15')).toBe(115);
    expect(rupeesToPaisa('19.99')).toBe(1999);
  });

  it.each(['', ' ', '.', 'abc', '1.2.3', '12a', '1e3', '--1', '1.234'])('rejects %j', (input) => {
    expect(() => rupeesToPaisa(input)).toThrow(RangeError);
  });

  it('rejects values beyond the safe integer range', () => {
    expect(() => rupeesToPaisa('999999999999999999')).toThrow(RangeError);
  });
});

describe('wholeRupeesToPaisa', () => {
  it('multiplies by 100', () => {
    expect(wholeRupeesToPaisa(2000)).toBe(200000);
    expect(wholeRupeesToPaisa(-5)).toBe(-500);
  });

  it('rejects non-integers', () => {
    expect(() => wholeRupeesToPaisa(1.5)).toThrow(RangeError);
  });
});

describe('paisaToRupeesString', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [50, '0.50'],
    [12050, '120.50'],
    [125075, '1250.75'],
    [-325, '-3.25'],
    [-5, '-0.05'],
  ])('formats %i as %j', (paisa, expected) => {
    expect(paisaToRupeesString(paisa)).toBe(expected);
  });

  it('round-trips with rupeesToPaisa', () => {
    for (const paisa of [0, 1, 99, 100, 12345, -12345, 9_007_199_254_740_991]) {
      expect(rupeesToPaisa(paisaToRupeesString(paisa))).toBe(paisa);
    }
  });

  it('rejects floats', () => {
    expect(() => paisaToRupeesString(1.5)).toThrow(RangeError);
  });
});

describe('isPaisa / assertPaisa', () => {
  it('accepts safe integers only', () => {
    expect(isPaisa(100)).toBe(true);
    expect(isPaisa(-100)).toBe(true);
    expect(isPaisa(1.5)).toBe(false);
    expect(isPaisa(Number.NaN)).toBe(false);
    expect(isPaisa('100')).toBe(false);
    expect(isPaisa(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(() => assertPaisa(0.1)).toThrow(RangeError);
  });
});

describe('sumPaisa', () => {
  it('adds integer amounts', () => {
    expect(sumPaisa([])).toBe(0);
    expect(sumPaisa([12050, 50, -100])).toBe(12000);
  });

  it('rejects float inputs and overflow', () => {
    expect(() => sumPaisa([1, 0.5])).toThrow(RangeError);
    expect(() => sumPaisa([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});
