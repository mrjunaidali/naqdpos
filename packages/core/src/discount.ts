// Discounts and free (FOC) items (US032, US033; architecture §3, §5). Pure, integer paisa.
// Order: line totals → line discounts → bill discount → round to the rupee → total.
// Nothing goes below zero: a discount is limited to what it applies to.
import type { CartLine } from './cart.ts';
import type { ProductRow, ProductUnit } from './catalogue.ts';
import { sumPaisa, type Paisa } from './money.ts';
import type { QtyMilli } from './qty.ts';
import { roundBill, type Bill } from './sale.ts';
import type { Role } from './tenancy.ts';

/** A discount as typed: rupees (`value` in paisa) or a whole percent 1–100. */
export interface Discount {
  kind: 'rs' | 'pct';
  value: number;
}

export type DiscountError = 'bad_discount' | 'too_much';

/** A whole percent of an amount, half up: 10% of Rs 214.55 = Rs 21.46 (2145.5 paisa → 2146). */
export function pctOfPaisa(base: Paisa, pct: number): Paisa {
  if (!Number.isSafeInteger(base) || base < 0) throw new RangeError('base');
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new RangeError('pct');
  return Number((BigInt(base) * BigInt(pct) + 50n) / 100n);
}

/** The discount in paisa on `base`, not limited (see discountOn). */
function rawDiscount(base: Paisa, discount: Discount): Paisa {
  return discount.kind === 'pct' ? pctOfPaisa(base, discount.value) : discount.value;
}

/** Checks a typed discount against what it applies to (on entry). */
export function checkDiscount(base: Paisa, discount: Discount): DiscountError | null {
  if (discount.kind === 'pct') {
    if (!Number.isInteger(discount.value) || discount.value < 1 || discount.value > 100) {
      return 'bad_discount';
    }
  } else if (!Number.isSafeInteger(discount.value) || discount.value <= 0) {
    return 'bad_discount';
  }
  return rawDiscount(base, discount) > base ? 'too_much' : null;
}

/** The discount in paisa, never more than `base` (a later change can shrink the base). */
export function discountOn(base: Paisa, discount: Discount | null | undefined): Paisa {
  if (!discount || base <= 0) return 0;
  if (checkDiscount(Number.MAX_SAFE_INTEGER, discount) === 'bad_discount') return 0;
  return Math.min(rawDiscount(base, discount), base);
}

// --- Lines ---

/** The line's price before its discount: qty × rate, or the typed amount for "by amount". */
export const lineGross = (line: Pick<CartLine, 'line_total_paisa'>): Paisa => line.line_total_paisa;

export function lineDiscountPaisa(
  line: Pick<CartLine, 'line_total_paisa' | 'is_foc' | 'discount'>,
) {
  return line.is_foc ? 0 : discountOn(line.line_total_paisa, line.discount);
}

/** What the customer pays for the line: 0 when free, else price − its discount. */
export function lineNet(line: Pick<CartLine, 'line_total_paisa' | 'is_foc' | 'discount'>): Paisa {
  return line.is_foc ? 0 : line.line_total_paisa - lineDiscountPaisa(line);
}

/** A free line's value at the sale price (kept for reports); 0 for a paid line. */
export function focValue(line: Pick<CartLine, 'line_total_paisa' | 'is_foc'>): Paisa {
  return line.is_foc ? line.line_total_paisa : 0;
}

// --- Bill ---

export interface BillSummary extends Bill {
  /** Price of the paid lines before any discount (the base of the cashier limit). */
  gross_paisa: Paisa;
  line_discount_paisa: Paisa;
  /** Value of the free lines at their sale price. */
  foc_value_paisa: Paisa;
  /** Line discounts + bill discount + free value: what the shop gives away on this bill. */
  give_away_paisa: Paisa;
}

/**
 * The whole bill: subtotal = sum of line nets; then the bill discount (limited to the subtotal);
 * then rounding to the nearest rupee (roundBill).
 */
export function computeBill(
  lines: readonly Pick<CartLine, 'line_total_paisa' | 'is_foc' | 'discount'>[],
  billDiscount: Discount | null = null,
): BillSummary {
  const paid = lines.filter((l) => !l.is_foc);
  const gross = sumPaisa(paid.map(lineGross));
  const lineDiscounts = sumPaisa(paid.map(lineDiscountPaisa));
  const foc = sumPaisa(lines.map(focValue));
  const subtotal = gross - lineDiscounts;
  const billDiscountPaisa = discountOn(subtotal, billDiscount);
  return {
    ...roundBill(subtotal, billDiscountPaisa),
    gross_paisa: gross,
    line_discount_paisa: lineDiscounts,
    foc_value_paisa: foc,
    give_away_paisa: lineDiscounts + billDiscountPaisa + foc,
  };
}

// --- Cashier limit ---

/** shops.cashier_max_discount_pct default (migration 20261122120000). */
export const DEFAULT_CASHIER_MAX_DISCOUNT_PCT = 10;

/** What the shop gives away on a bill, and the base the cashier limit applies to. */
export function giveAway(
  lines: readonly Pick<CartLine, 'line_total_paisa' | 'is_foc' | 'discount'>[],
  billDiscount: Discount | null = null,
): { give_away_paisa: Paisa; base_paisa: Paisa } {
  const bill = computeBill(lines, billDiscount);
  return { give_away_paisa: bill.give_away_paisa, base_paisa: bill.gross_paisa };
}

/** Owners have no limit; a cashier's give-away stays within limitPct % of the paid lines' price. */
export function withinLimit(
  role: Role | null | undefined,
  amounts: { give_away_paisa: Paisa; base_paisa: Paisa },
  limitPct: number,
): boolean {
  // Nothing given away needs nobody's approval (also while the seller is still loading).
  if (amounts.give_away_paisa === 0) return true;
  if (role === 'owner') return true;
  if (!role) return false;
  return BigInt(amounts.give_away_paisa) * 100n <= BigInt(amounts.base_paisa) * BigInt(limitPct);
}

/** An owner's approval covers a give-away up to the amount they saw. */
export interface DiscountApproval {
  staffId: string;
  give_away_paisa: Paisa;
}

export function approvalCovers(
  approval: DiscountApproval | null | undefined,
  give_away_paisa: Paisa,
): boolean {
  return !!approval && approval.give_away_paisa >= give_away_paisa;
}

// --- Free with purchase (foc_rule) ---

export interface FocRule {
  min_bill_paisa: Paisa;
  qty_milli: QtyMilli;
}

/** Same as the SQL check foc_rule_ok(). */
export const MAX_FOC_QTY_MILLI = 9_999_000;

/** The rule a preset suggests (US033): from a Rs 200 bill, 1 bundle / piece / dozen or 50 g / ml. */
export function suggestedFocRule(unit: ProductUnit): FocRule {
  const qty = unit === 'kg' || unit === 'litre' ? 50 : unit === 'g' ? 50_000 : 1000;
  return { min_bill_paisa: 20_000, qty_milli: qty };
}

export interface FocSuggestion {
  product: ProductRow;
  qty_milli: QtyMilli;
}

export const MAX_FOC_SUGGESTIONS = 3;

/**
 * Products to offer free (one-tap, never added automatically): the bill subtotal (after line
 * discounts) has reached the product's minimum bill and the product is not in the cart.
 */
export function focSuggestions(
  lines: readonly Pick<CartLine, 'product_id' | 'line_total_paisa' | 'is_foc' | 'discount'>[],
  products: readonly ProductRow[],
): FocSuggestion[] {
  const subtotal = computeBill(lines).subtotal_paisa;
  if (subtotal <= 0) return [];
  const inCart = new Set(lines.map((l) => l.product_id));
  return products
    .filter(
      (p): p is ProductRow & { foc_rule: FocRule } =>
        p.deleted_at === null &&
        p.foc_rule !== null &&
        !inCart.has(p.id) &&
        subtotal >= p.foc_rule.min_bill_paisa,
    )
    .sort(
      (a, b) =>
        b.foc_rule.min_bill_paisa - a.foc_rule.min_bill_paisa || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_FOC_SUGGESTIONS)
    .map((p) => ({ product: p, qty_milli: p.foc_rule.qty_milli }));
}
