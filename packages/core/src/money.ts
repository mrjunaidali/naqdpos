// Money is always an integer number of paisa (Rs 1 = 100 paisa). Never use floats for money.
import { assertSafeInteger, formatFixed, parseFixed } from './fixed.ts';

/** Integer paisa. Alias for readability; validate with `assertPaisa`. */
export type Paisa = number;

export const PAISA_PER_RUPEE = 100;

export function isPaisa(value: unknown): value is Paisa {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertPaisa(value: number): asserts value is Paisa {
  assertSafeInteger(value, 'paisa');
}

/** Parse user input in rupees ("120", "120.5", "1,250.75") into paisa. Max 2 decimals. */
export function rupeesToPaisa(input: string): Paisa {
  return parseFixed(input, 2, 'rupees');
}

/** Whole rupees (an integer) to paisa. */
export function wholeRupeesToPaisa(rupees: number): Paisa {
  assertSafeInteger(rupees, 'rupees');
  const paisa = rupees * PAISA_PER_RUPEE;
  assertPaisa(paisa);
  return paisa;
}

/** Plain decimal rupee string, e.g. 125050 → "1250.50". Display formatting (grouping, "Rs") belongs to the UI/i18n layer. */
export function paisaToRupeesString(paisa: Paisa): string {
  return formatFixed(paisa, 2, 'paisa');
}

/** Sum paisa amounts, throwing if any input or the result is not a safe integer. */
export function sumPaisa(amounts: readonly Paisa[]): Paisa {
  let total = 0;
  for (const amount of amounts) {
    assertPaisa(amount);
    total += amount;
  }
  assertPaisa(total);
  return total;
}
