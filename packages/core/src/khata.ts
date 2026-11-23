// Customers and khata (US038–US041; architecture §3). Balance = sum of entries; positive means
// the customer owes the shop. Entries are append-only; corrections are owner 'adjustment's.
import { uuidv7 } from './ids.ts';
import { paisaToRupeesString, sumPaisa, type Paisa } from './money.ts';
import type { PaymentRow } from './sale.ts';
import { businessDate, businessDateFor } from './sale.ts';
import type { Role } from './tenancy.ts';

export interface CustomerRow {
  /** UUIDv5(shop_id, E.164 mobile): see customerId() in uuid5.ts. */
  id: string;
  shop_id: string;
  /** E.164 (+923001234567); never changes after creation. */
  mobile: string;
  name: string | null;
  address: string | null;
  credit_limit_paisa: Paisa | null;
  whatsapp_opt_in: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
  server_seq: number | null;
}

export const KHATA_TYPES = ['credit_sale', 'payment', 'return_credit', 'adjustment'] as const;
export type KhataType = (typeof KHATA_TYPES)[number];

export interface KhataEntryRow {
  id: string;
  shop_id: string;
  customer_id: string;
  business_date: string;
  type: KhataType;
  /** Positive = the customer owes more; never 0. */
  amount_paisa: Paisa;
  sale_id: string | null;
  payment_id: string | null;
  note: string | null;
  staff_id: string;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

export const MAX_KHATA_NOTE_LENGTH = 200;
export const DEFAULT_OVERDUE_DAYS = 30;

// --- Balances ---

export function khataBalance(entries: readonly Pick<KhataEntryRow, 'amount_paisa'>[]): Paisa {
  return sumPaisa(entries.map((e) => e.amount_paisa));
}

type Ordered = Pick<KhataEntryRow, 'id' | 'business_date' | 'created_at' | 'amount_paisa'>;

/** Ledger order: business date, then time, then id (UUIDv7, creation order). */
export function sortEntries<T extends Ordered>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      a.business_date.localeCompare(b.business_date) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/** Each entry with the balance after it, oldest first. */
export function runningBalance<T extends Ordered>(
  entries: readonly T[],
): (T & { balance_paisa: Paisa })[] {
  let balance = 0;
  return sortEntries(entries).map((e) => {
    balance += e.amount_paisa;
    return { ...e, balance_paisa: balance };
  });
}

/** Whole days from one business date to another (YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The latest khata payment's business date, or null. */
export function lastKhataPayment(
  entries: readonly Pick<KhataEntryRow, 'type' | 'business_date'>[],
): string | null {
  let last: string | null = null;
  for (const e of entries) {
    if (e.type === 'payment' && (last === null || e.business_date > last)) last = e.business_date;
  }
  return last;
}

/**
 * Overdue (decided 22 Nov 2026): the balance is above 0 and there has been no khata payment for
 * `days` days. A customer who never paid counts from their first entry.
 */
export function isOverdue(
  entries: readonly Pick<KhataEntryRow, 'type' | 'business_date' | 'amount_paisa'>[],
  now: Date,
  days: number = DEFAULT_OVERDUE_DAYS,
): boolean {
  if (khataBalance(entries) <= 0 || entries.length === 0) return false;
  const since =
    lastKhataPayment(entries) ??
    entries.reduce(
      (min, e) => (e.business_date < min ? e.business_date : min),
      entries[0]!.business_date,
    );
  return daysBetween(since, businessDate(now)) >= days;
}

// --- A bill split between money and khata ---

/** What goes on khata when payments cover part of the total. */
export function splitWithKhata(
  total: Paisa,
  payments: readonly { amount_paisa: Paisa }[],
): { khata_paisa: Paisa } | { error: 'overpaid' } {
  const paid = sumPaisa(payments.map((p) => p.amount_paisa));
  if (paid > total) return { error: 'overpaid' };
  return { khata_paisa: total - paid };
}

// --- Writing ---

export interface KhataContext {
  shopId: string;
  deviceId: string | null;
  staffId: string;
  now: Date;
  /** Closed business dates: new entries roll forward to the next open day. */
  closedDates?: ReadonlySet<string> | undefined;
}

function entry(
  ctx: KhataContext,
  over: Pick<KhataEntryRow, 'customer_id' | 'type' | 'amount_paisa'> &
    Partial<Pick<KhataEntryRow, 'sale_id' | 'payment_id' | 'note'>>,
): KhataEntryRow {
  return {
    id: uuidv7(),
    shop_id: ctx.shopId,
    business_date: businessDateFor(ctx.now, ctx.closedDates),
    sale_id: null,
    payment_id: null,
    note: null,
    staff_id: ctx.staffId,
    created_at: ctx.now.toISOString(),
    device_id: ctx.deviceId,
    server_seq: null,
    ...over,
  };
}

/** The credit_sale entry for the part of a sale put on khata. */
export function creditSaleEntry(
  ctx: KhataContext,
  customerId: string,
  saleId: string,
  amountPaisa: Paisa,
): KhataEntryRow {
  return entry(ctx, {
    customer_id: customerId,
    type: 'credit_sale',
    amount_paisa: amountPaisa,
    sale_id: saleId,
  });
}

export type KhataError = 'bad_amount' | 'forbidden' | 'note_required' | 'note_too_long';

/** "Receive payment" (US040): a khata_receipt payment and the matching negative entry. */
export function buildKhataReceipt(
  ctx: KhataContext & { customerId: string; methodCode: string; reference?: string | null },
  amountPaisa: Paisa,
): { payment: PaymentRow; entry: KhataEntryRow } | { error: KhataError } {
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0) return { error: 'bad_amount' };
  const payment: PaymentRow = {
    id: uuidv7(),
    shop_id: ctx.shopId,
    business_date: businessDateFor(ctx.now, ctx.closedDates),
    kind: 'khata_receipt',
    sale_id: null,
    customer_id: ctx.customerId,
    method_code: ctx.methodCode,
    amount_paisa: amountPaisa,
    reference: ctx.reference?.trim() || null,
    staff_id: ctx.staffId,
    created_at: ctx.now.toISOString(),
    device_id: ctx.deviceId,
    server_seq: null,
  };
  return {
    payment,
    entry: entry(ctx, {
      customer_id: ctx.customerId,
      type: 'payment',
      amount_paisa: -amountPaisa,
      payment_id: payment.id,
    }),
  };
}

/** "Adjust balance" (owner only): + the customer owes more, − less; a note is required. */
export function buildKhataAdjustment(
  ctx: KhataContext & { customerId: string; role: Role | null | undefined },
  amountPaisa: Paisa,
  note: string,
): KhataEntryRow | { error: KhataError } {
  if (ctx.role !== 'owner') return { error: 'forbidden' };
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa === 0) return { error: 'bad_amount' };
  const text = note.trim();
  if (!text) return { error: 'note_required' };
  if ([...text].length > MAX_KHATA_NOTE_LENGTH) return { error: 'note_too_long' };
  return entry(ctx, {
    customer_id: ctx.customerId,
    type: 'adjustment',
    amount_paisa: amountPaisa,
    note: text,
  });
}

// --- Sharing ---

/** "1,200" or "1,200.50": rupees with thousands separators (Latin digits, also in Urdu). */
export function rupeesText(paisa: Paisa): string {
  const [whole, frac] = paisaToRupeesString(Math.abs(paisa)).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = frac && frac !== '00' ? `${grouped}.${frac}` : grouped;
  return paisa < 0 ? `-${text}` : text;
}

/**
 * The WhatsApp receipt for a khata payment, in the app language: the words come from i18n
 * (`khata.whatsappText`) so they are reviewed with the rest; amounts are grouped Latin digits.
 */
export function khataReceiptText(
  label: (key: string, vars: Record<string, string>) => string,
  amountPaisa: Paisa,
  balancePaisa: Paisa,
  shopName: string,
): string {
  return label('khata.whatsappText', {
    amount: rupeesText(amountPaisa),
    balance: rupeesText(balancePaisa),
    shop: shopName,
  });
}

/** wa.me link: digits only, no "+". */
export function waLink(e164: string, text?: string): string {
  const base = `https://wa.me/${e164.replace(/\D/g, '')}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function telLink(e164: string): string {
  return `tel:${e164}`;
}
