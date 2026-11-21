// The cart (US029, US030): lines and totals before payment. Pure and integer-only: money in paisa,
// quantities in qty_milli (thousandths of the product's unit); BigInt where values multiply.
import type { ProductUnit } from './catalogue.ts';
import { lineNet, type Discount } from './discount.ts';
import { parseFixed } from './fixed.ts';
import { uuidv7 } from './ids.ts';
import { sumPaisa, type Paisa } from './money.ts';
import { MILLI_PER_UNIT, priceForQty, type QtyMilli } from './qty.ts';

export interface CartLine {
  id: string;
  /** null for a custom item (US030). */
  product_id: string | null;
  is_custom: boolean;
  /**
   * "By amount" (e.g. Rs 100 of tomatoes): the line total is the typed amount and qty is derived
   * from it, so qty × rate may differ from the total by a few paisa. Reports must know.
   */
  by_amount: boolean;
  /** Snapshots taken when the line is made; later product edits do not change the cart. */
  name: string;
  name_ur: string | null;
  unit: ProductUnit;
  icon: string | null;
  qty_milli: QtyMilli;
  unit_price_paisa: Paisa;
  /** The line's price before its discount (qty × rate, or the typed amount). */
  line_total_paisa: Paisa;
  /** Free of charge (US033): the customer pays 0; the price stays for reports. */
  is_foc: boolean;
  /** The line discount as typed (US032); applied by lineNet() in discount.ts. */
  discount: Discount | null;
}

/** A cart line saved before discounts existed gets the new fields (stored carts survive updates). */
export function normalizeCartLine(line: CartLine): CartLine {
  return { ...line, is_foc: line.is_foc ?? false, discount: line.discount ?? null };
}

/** Sanity limit per line: 9,999 units (catches "15000" typed for 1.5). */
export const MAX_LINE_UNITS = 9_999;
export const MAX_LINE_QTY_MILLI = MAX_LINE_UNITS * MILLI_PER_UNIT;
/** "By amount" rounds the quantity to the nearest 5 g / 5 ml (5 thousandths of kg / litre). */
export const AMOUNT_QTY_STEP_MILLI = 5;

interface UnitRule {
  /** Decimals the keypad allows for this unit. */
  decimals: number;
  /** "By amount" (type rupees) is offered. */
  byAmount: boolean;
  /** Quick buttons, in qty_milli. */
  quick: readonly QtyMilli[];
}

/**
 * Per-unit entry rules. `g` products are priced per gram and typed in whole grams, so
 * qty_milli = grams × 1000.
 */
export const UNIT_RULES: Record<ProductUnit, UnitRule> = {
  kg: { decimals: 3, byAmount: true, quick: [250, 500, 1000, 1500] },
  litre: { decimals: 3, byAmount: true, quick: [250, 500, 1000, 1500] },
  dozen: { decimals: 3, byAmount: false, quick: [500, 1000, 2000, 3000] },
  piece: { decimals: 0, byAmount: false, quick: [1000, 2000, 6000, 12000] },
  bundle: { decimals: 0, byAmount: false, quick: [1000, 2000, 3000, 5000] },
  g: { decimals: 0, byAmount: false, quick: [] },
};

export type QtyInputError = 'invalid' | 'zero' | 'too_many_decimals' | 'too_large';

/** Keypad text → qty_milli under the unit's rules. */
export function parseQtyInput(
  text: string,
  unit: ProductUnit,
): { qty_milli: QtyMilli } | { error: QtyInputError } {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    return { error: 'invalid' };
  }
  const decimals = trimmed.includes('.') ? trimmed.split('.')[1]!.length : 0;
  if (decimals > UNIT_RULES[unit].decimals) return { error: 'too_many_decimals' };
  let qty: number;
  try {
    qty = parseFixed(trimmed, 3, 'qty');
  } catch {
    return { error: 'too_large' };
  }
  if (qty === 0) return { error: 'zero' };
  if (qty > MAX_LINE_QTY_MILLI) return { error: 'too_large' };
  return { qty_milli: qty };
}

/**
 * Quantity for an amount at a rate: amount ÷ rate in qty_milli, rounded half up to the nearest
 * `step` (5 g for kg). Exact integer maths. The rate must be above 0.
 */
export function qtyForAmount(
  amountPaisa: Paisa,
  unitPricePaisa: Paisa,
  step: number = AMOUNT_QTY_STEP_MILLI,
): QtyMilli {
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa < 0) throw new RangeError('amount');
  if (!Number.isSafeInteger(unitPricePaisa) || unitPricePaisa <= 0) {
    throw new RangeError('a rate above 0 is needed');
  }
  const numerator = BigInt(amountPaisa) * BigInt(MILLI_PER_UNIT);
  const denominator = BigInt(unitPricePaisa) * BigInt(step);
  let steps = numerator / denominator;
  if ((numerator % denominator) * 2n >= denominator) steps += 1n;
  return Number(steps * BigInt(step));
}

export type LineSource = Pick<
  CartLine,
  'product_id' | 'name' | 'name_ur' | 'unit' | 'icon' | 'unit_price_paisa'
> & { is_custom?: boolean };

export type LineError = 'invalid_qty' | 'rate_needed' | 'amount_too_small' | 'too_large';

/** A line by quantity: total = priceForQty (half away from zero to whole paisa). */
export function makeLine(
  source: LineSource,
  qtyMilli: QtyMilli,
  id: string = uuidv7(),
): CartLine | { error: LineError } {
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli <= 0) return { error: 'invalid_qty' };
  if (qtyMilli > MAX_LINE_QTY_MILLI) return { error: 'too_large' };
  return {
    id,
    product_id: source.product_id,
    is_custom: source.is_custom ?? source.product_id === null,
    by_amount: false,
    name: source.name,
    name_ur: source.name_ur,
    unit: source.unit,
    icon: source.icon,
    qty_milli: qtyMilli,
    unit_price_paisa: source.unit_price_paisa,
    line_total_paisa: priceForQty(qtyMilli, source.unit_price_paisa),
    is_foc: false,
    discount: null,
  };
}

/** A line by amount: the typed amount IS the total; qty is derived (5 g steps). */
export function makeAmountLine(
  source: LineSource,
  amountPaisa: Paisa,
  id: string = uuidv7(),
): CartLine | { error: LineError } {
  if (source.unit_price_paisa <= 0) return { error: 'rate_needed' };
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0) return { error: 'amount_too_small' };
  const qty = qtyForAmount(amountPaisa, source.unit_price_paisa);
  if (qty <= 0) return { error: 'amount_too_small' };
  if (qty > MAX_LINE_QTY_MILLI) return { error: 'too_large' };
  return {
    id,
    product_id: source.product_id,
    is_custom: source.is_custom ?? source.product_id === null,
    by_amount: true,
    name: source.name,
    name_ur: source.name_ur,
    unit: source.unit,
    icon: source.icon,
    qty_milli: qty,
    unit_price_paisa: source.unit_price_paisa,
    line_total_paisa: amountPaisa,
    is_foc: false,
    discount: null,
  };
}

export function isLineError(value: CartLine | { error: LineError }): value is { error: LineError } {
  return 'error' in value;
}

export interface CartTotals {
  itemCount: number;
  subtotal_paisa: Paisa;
  /** After line discounts, before the bill discount and rounding (those are on the pay screen). */
  total_paisa: Paisa;
}

export function cartTotals(lines: readonly CartLine[]): CartTotals {
  const subtotal = sumPaisa(lines.map(lineNet));
  return { itemCount: lines.length, subtotal_paisa: subtotal, total_paisa: subtotal };
}

export interface QtyLabel {
  /** Number to show (shortest form), or "½". */
  amount: string;
  /** Unit to show: below 1 kg / 1 litre the small unit. */
  unit: ProductUnit | 'ml';
}

/** "250 g", "1.5 kg", "750 ml", "½ dozen", "6 piece": for badges and cart lines. */
export function qtyLabel(qtyMilli: QtyMilli, unit: ProductUnit): QtyLabel {
  if ((unit === 'kg' || unit === 'litre') && qtyMilli < MILLI_PER_UNIT) {
    // qty_milli of a kg is grams (of a litre, ml)
    return { amount: String(qtyMilli), unit: unit === 'kg' ? 'g' : 'ml' };
  }
  if (unit === 'dozen' && qtyMilli === 500) return { amount: '½', unit };
  const whole = Math.trunc(qtyMilli / MILLI_PER_UNIT);
  const frac = String(qtyMilli % MILLI_PER_UNIT)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return { amount: frac ? `${whole}.${frac}` : String(whole), unit };
}
