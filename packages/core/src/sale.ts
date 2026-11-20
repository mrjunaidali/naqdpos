// Completing a sale (US034, US035; architecture §3 ledgers). Pure: the bill, payments, change,
// business date, receipt number and the rows to write. Money is integer paisa.
import type { CartLine } from './cart.ts';
import type { ProductUnit } from './catalogue.ts';
import { uuidv7 } from './ids.ts';
import { sumPaisa, type Paisa } from './money.ts';
import { DEFAULT_TIMEZONE } from './tenancy.ts';

// --- Rows (architecture §3) ---

export interface PaymentMethodRow {
  id: string;
  shop_id: string;
  /** cash | jazzcash | easypaisa | bank | custom_<8 hex>. */
  code: string;
  label: string;
  active: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
  server_seq: number | null;
}

/** Built-in methods, named through i18n (payment.method.<code>); custom ones show their label. */
export const BUILT_IN_METHODS = ['cash', 'jazzcash', 'easypaisa', 'bank'] as const;

export interface SaleRow {
  id: string;
  shop_id: string;
  receipt_no: string;
  business_date: string;
  staff_id: string;
  customer_id: string | null;
  order_type: 'walk_in' | 'delivery';
  source: string;
  subtotal_paisa: Paisa;
  discount_paisa: Paisa;
  /** Signed: + rounds up, − rounds down, to a whole rupee (between −50 and +50). */
  rounding_paisa: Paisa;
  total_paisa: Paisa;
  note: string | null;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

export interface SaleLineRow {
  id: string;
  shop_id: string;
  sale_id: string;
  product_id: string | null;
  name_snapshot: string;
  name_ur_snapshot: string | null;
  unit_snapshot: ProductUnit;
  qty_milli: number;
  unit_price_paisa: Paisa;
  discount_paisa: Paisa;
  is_foc: boolean;
  by_amount: boolean;
  line_total_paisa: Paisa;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

export const PAYMENT_KINDS = [
  'sale',
  'khata_receipt',
  'refund',
  'supplier_payment',
  'rider_handover',
] as const;

export interface PaymentRow {
  id: string;
  shop_id: string;
  business_date: string;
  kind: (typeof PAYMENT_KINDS)[number];
  sale_id: string | null;
  customer_id: string | null;
  method_code: string;
  /** For cash: the amount applied to the bill, never the amount tendered. */
  amount_paisa: Paisa;
  reference: string | null;
  staff_id: string;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

// --- Bill ---

export interface Bill {
  subtotal_paisa: Paisa;
  discount_paisa: Paisa;
  rounding_paisa: Paisa;
  total_paisa: Paisa;
}

/**
 * The bill rounded to the nearest whole rupee, half up (decided 21 Nov 2026):
 * Rs 214.50 → Rs 215 (+50), Rs 214.49 → Rs 214 (−49).
 */
export function roundBill(subtotal: Paisa, discount: Paisa = 0): Bill {
  const due = subtotal - discount;
  if (!Number.isSafeInteger(due) || due < 0) throw new RangeError('bill below 0');
  const paisa = due % 100;
  const rounding = paisa === 0 ? 0 : paisa >= 50 ? 100 - paisa : -paisa; // never -0
  return {
    subtotal_paisa: subtotal,
    discount_paisa: discount,
    rounding_paisa: rounding,
    total_paisa: due + rounding,
  };
}

export interface PaymentDraft {
  method_code: string;
  /** Applied to the bill (for cash: at most what was due). */
  amount_paisa: Paisa;
  reference: string | null;
  /** Cash only: what the customer handed over. */
  tendered_paisa?: Paisa;
}

export function remainingDue(
  total: Paisa,
  payments: readonly Pick<PaymentDraft, 'amount_paisa'>[],
) {
  return total - sumPaisa(payments.map((p) => p.amount_paisa));
}

/** Change for cash handed over against what is still due (never negative). */
export function changeDue(tendered: Paisa, due: Paisa): Paisa {
  return Math.max(0, tendered - due);
}

export type PaymentError = 'nothing_due' | 'zero' | 'too_much' | 'not_enough_cash';

/**
 * One more payment against what is still due. Cash may be more than due (the change goes back;
 * the row records only what was applied). Other methods may not pay more than due.
 */
export function applyPayment(
  due: Paisa,
  methodCode: string,
  amount: Paisa,
  reference: string | null = null,
): { payment: PaymentDraft; change_paisa: Paisa } | { error: PaymentError } {
  if (due <= 0) return { error: 'nothing_due' };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'zero' };
  if (methodCode === 'cash') {
    const applied = Math.min(amount, due);
    return {
      payment: { method_code: 'cash', amount_paisa: applied, reference, tendered_paisa: amount },
      change_paisa: changeDue(amount, due),
    };
  }
  if (amount > due) return { error: 'too_much' };
  return { payment: { method_code: methodCode, amount_paisa: amount, reference }, change_paisa: 0 };
}

// --- Business date and receipt numbers ---

/** The shop's local date (architecture §2 rule 6), "YYYY-MM-DD"; Karachi is UTC+5 all year. */
export function businessDate(instant: Date | number = Date.now(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "A2-000001": device code + per-device counter, at least 6 digits. */
export function receiptNo(deviceCode: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('receipt counter');
  return `${deviceCode}-${String(n).padStart(6, '0')}`;
}

/** The counter in a receipt number of this device code, or null ("A2-000017" → 17). */
export function receiptCounter(receipt: string, deviceCode: string): number | null {
  const prefix = `${deviceCode}-`;
  if (!receipt.startsWith(prefix)) return null;
  const digits = receipt.slice(prefix.length);
  return /^[0-9]{6,}$/.test(digits) ? Number(digits) : null;
}

// --- The rows of one sale ---

export interface SaleContext {
  shopId: string;
  deviceId: string | null;
  staffId: string;
  receiptNo: string;
  now: Date;
}

export type SaleError = 'empty_cart' | 'not_paid' | 'overpaid' | 'bad_payment';

export interface SaleRows {
  sale: SaleRow;
  lines: SaleLineRow[];
  payments: PaymentRow[];
}

/**
 * The rows for a paid cart. Checks what the database cannot check across rows: there is at least
 * one line, line totals add up to the subtotal, payments add up exactly to the rounded total.
 */
export function buildSale(
  cart: readonly CartLine[],
  payments: readonly PaymentDraft[],
  ctx: SaleContext,
): SaleRows | { error: SaleError } {
  if (cart.length === 0) return { error: 'empty_cart' };
  if (payments.some((p) => !Number.isSafeInteger(p.amount_paisa) || p.amount_paisa <= 0)) {
    return { error: 'bad_payment' };
  }
  const bill = roundBill(sumPaisa(cart.map((l) => l.line_total_paisa)));
  const left = remainingDue(bill.total_paisa, payments);
  if (left > 0) return { error: 'not_paid' };
  if (left < 0) return { error: 'overpaid' };

  const created = ctx.now.toISOString();
  const date = businessDate(ctx.now);
  const saleId = uuidv7();
  const sale: SaleRow = {
    id: saleId,
    shop_id: ctx.shopId,
    receipt_no: ctx.receiptNo,
    business_date: date,
    staff_id: ctx.staffId,
    customer_id: null,
    order_type: 'walk_in',
    source: 'walk_in',
    ...bill,
    note: null,
    created_at: created,
    device_id: ctx.deviceId,
    server_seq: null,
  };
  const lines = cart.map((l): SaleLineRow => ({
    id: uuidv7(),
    shop_id: ctx.shopId,
    sale_id: saleId,
    product_id: l.product_id,
    name_snapshot: l.name,
    name_ur_snapshot: l.name_ur,
    unit_snapshot: l.unit,
    qty_milli: l.qty_milli,
    unit_price_paisa: l.unit_price_paisa,
    discount_paisa: 0,
    is_foc: false,
    by_amount: l.by_amount,
    line_total_paisa: l.line_total_paisa,
    created_at: created,
    device_id: ctx.deviceId,
    server_seq: null,
  }));
  const paymentRows = payments.map((p): PaymentRow => ({
    id: uuidv7(),
    shop_id: ctx.shopId,
    business_date: date,
    kind: 'sale',
    sale_id: saleId,
    customer_id: null,
    method_code: p.method_code,
    amount_paisa: p.amount_paisa,
    reference: p.reference?.trim() || null,
    staff_id: ctx.staffId,
    created_at: created,
    device_id: ctx.deviceId,
    server_seq: null,
  }));
  return { sale, lines, payments: paymentRows };
}
