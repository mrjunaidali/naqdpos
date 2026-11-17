// Quantities are integer thousandths of the product's unit (1.5 kg = 1500). Never use floats.
import { assertSafeInteger, formatFixed, mulDivRound, parseFixed } from './fixed.ts';
import { assertPaisa, type Paisa } from './money.ts';

/** Integer thousandths of a unit. Validate with `assertQtyMilli`. */
export type QtyMilli = number;

export const MILLI_PER_UNIT = 1000;

export function isQtyMilli(value: unknown): value is QtyMilli {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertQtyMilli(value: number): asserts value is QtyMilli {
  assertSafeInteger(value, 'qty_milli');
}

/** Parse user input in units ("1.5", "0.25", "3") into qty_milli. Max 3 decimals. */
export function parseQty(input: string): QtyMilli {
  return parseFixed(input, 3, 'qty');
}

/** Whole units (an integer, e.g. 3 pieces) to qty_milli. */
export function unitsToQtyMilli(units: number): QtyMilli {
  assertSafeInteger(units, 'units');
  const milli = units * MILLI_PER_UNIT;
  assertQtyMilli(milli);
  return milli;
}

/** Shortest decimal string for a quantity: 1500 → "1.5", 2000 → "2", 125 → "0.125". */
export function formatQty(qtyMilli: QtyMilli): string {
  const fixed = formatFixed(qtyMilli, 3, 'qty_milli');
  return fixed.replace(/\.?0+$/, '');
}

/**
 * Price for a quantity: qty_milli × unit price ÷ 1000, rounded half away from zero to whole paisa.
 * Computed with BigInt so large values never lose precision.
 */
export function priceForQty(qtyMilli: QtyMilli, unitPricePaisa: Paisa): Paisa {
  assertQtyMilli(qtyMilli);
  assertPaisa(unitPricePaisa);
  const total = mulDivRound(qtyMilli, unitPricePaisa, MILLI_PER_UNIT);
  assertPaisa(total);
  return total;
}
