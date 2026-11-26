// Daily closing (US044, US045, US067; architecture §3 day_closes, derived values, §4, §7). Pure.
// One cash drawer per shop: expected cash covers every device's rows of that business date.
import type { ExpenseRow } from './expenses.ts';
import type { KhataEntryRow } from './khata.ts';
import { rupeesText } from './khata.ts';
import { priceForQty } from './qty.ts';
import type { LabelFn, ReceiptDoc, ReceiptLine } from './receipt.ts';
import { receiptDateTime } from './receipt.ts';
import type { PaymentRow, SaleLineRow, SaleRow } from './sale.ts';
import { businessDate } from './sale.ts';

export { businessDateFor, nextDate } from './sale.ts';
import type { StockMovementRow } from './stock.ts';
import { uuidv7 } from './ids.ts';
import type { PaperWidth, Role } from './tenancy.ts';
import type { Paisa } from './money.ts';
import { isProductUnit, type UnitCode } from './catalogue.ts';
import { qtyLabel } from './cart.ts';

export interface DayCloseRow {
  id: string;
  shop_id: string;
  business_date: string;
  opening_cash_paisa: Paisa;
  expected_cash_paisa: Paisa;
  counted_cash_paisa: Paisa;
  /** counted − expected: below 0 = short, above 0 = over. */
  difference_paisa: Paisa;
  /** Cash the owner takes home: not an expense. */
  owner_withdrawal_paisa: Paisa;
  note: string | null;
  closed_by_staff_id: string;
  closed_at: string;
  /** The closing device's pull cursor when it closed (approved 22 Nov 2026). */
  seen_through_seq: number;
  device_id: string | null;
  server_seq: number | null;
}

// --- Expected cash ---

type CashPayment = Pick<PaymentRow, 'kind' | 'method_code' | 'amount_paisa'>;
type CashExpense = Pick<ExpenseRow, 'paid_method_code' | 'amount_paisa'>;

/** Payment kinds that bring cash into the drawer; the others take it out. */
const CASH_IN = new Set<PaymentRow['kind']>(['sale', 'khata_receipt', 'rider_handover']);

/**
 * opening + cash sale payments + cash khata receipts + rider handovers − cash expenses (net of
 * reversals) − cash refunds − cash supplier payments − owner withdrawal. Same as the SQL
 * function shop_expected_cash(); refunds, handovers and supplier payments are 0 until they exist.
 */
export function expectedCash(input: {
  openingPaisa: Paisa;
  payments: readonly CashPayment[];
  expenses: readonly CashExpense[];
  withdrawalPaisa: Paisa;
}): Paisa {
  let total = input.openingPaisa - input.withdrawalPaisa;
  for (const p of input.payments) {
    if (p.method_code !== 'cash') continue;
    total += CASH_IN.has(p.kind) ? p.amount_paisa : -p.amount_paisa;
  }
  for (const e of input.expenses) if (e.paid_method_code === 'cash') total -= e.amount_paisa;
  return total;
}

/** Cash in the drawer to start the day: the last count minus what the owner took home. */
export function openingDefault(
  previous: Pick<DayCloseRow, 'counted_cash_paisa' | 'owner_withdrawal_paisa'> | null | undefined,
): Paisa {
  return previous ? Math.max(0, previous.counted_cash_paisa - previous.owner_withdrawal_paisa) : 0;
}

// --- Business dates around a close ---

/** Days to close, oldest first: dates with activity up to today that are not closed. */
export function closableDays(
  activityDates: Iterable<string>,
  closedDates: ReadonlySet<string>,
  today: string,
): string[] {
  const days = new Set<string>();
  for (const d of activityDates) if (d <= today && !closedDates.has(d)) days.add(d);
  if (days.size === 0 && !closedDates.has(today)) days.add(today);
  return [...days].sort();
}

/**
 * Distinct business dates of ledger rows, oldest first: the "activity" closableDays() needs.
 * Replaces Dexie's orderBy('business_date').uniqueKeys(), whose unique-direction key cursor iOS
 * WebKit refuses ("UnknownError: Unable to open cursor", bug 2026-11-25): the app reads plain rows
 * and dedupes here. Rows without a string date are skipped (an index would not hold them either).
 */
export function activityDates(
  ...tables: readonly (readonly { business_date?: unknown }[])[]
): string[] {
  const dates = new Set<string>();
  for (const rows of tables)
    for (const row of rows) if (typeof row.business_date === 'string') dates.add(row.business_date);
  return [...dates].sort();
}

/**
 * Lines in the order an anyOf() over the sale_id index gave them (sale_id, then line id), so
 * reading each sale's lines with a single-field equals() changes nothing downstream.
 */
export function sortSaleLines<T extends { sale_id: string; id: string }>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) =>
    a.sale_id === b.sale_id
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.sale_id < b.sale_id
        ? -1
        : 1,
  );
}

// --- Counting ---

/** Pakistani notes and coins, in paisa. */
export const DENOMINATIONS = [
  { paisa: 500_000, coin: false },
  { paisa: 100_000, coin: false },
  { paisa: 50_000, coin: false },
  { paisa: 10_000, coin: false },
  { paisa: 5_000, coin: false },
  { paisa: 2_000, coin: false },
  { paisa: 1_000, coin: false },
  { paisa: 500, coin: true },
  { paisa: 200, coin: true },
  { paisa: 100, coin: true },
] as const;

/** Total of a count: { denomination paisa → number of notes / coins }. */
export function denominationTotal(counts: Readonly<Record<number, number>>): Paisa {
  let total = 0;
  for (const { paisa } of DENOMINATIONS) {
    const n = counts[paisa] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('count');
    total += n * paisa;
  }
  return total;
}

// --- Writing the close ---

export type CloseError = 'forbidden' | 'already_closed' | 'future' | 'bad_amount' | 'note_too_long';

export function buildDayClose(
  input: {
    businessDate: string;
    openingPaisa: Paisa;
    expectedPaisa: Paisa;
    countedPaisa: Paisa;
    withdrawalPaisa: Paisa;
    note: string | null;
    seenThroughSeq: number;
  },
  ctx: {
    shopId: string;
    deviceId: string | null;
    staffId: string;
    role: Role | null | undefined;
    now: Date;
    closedDates: ReadonlySet<string>;
  },
): DayCloseRow | { error: CloseError } {
  if (ctx.role !== 'owner') return { error: 'forbidden' };
  if (ctx.closedDates.has(input.businessDate)) return { error: 'already_closed' };
  if (input.businessDate > businessDate(ctx.now)) return { error: 'future' };
  for (const v of [input.openingPaisa, input.countedPaisa, input.withdrawalPaisa]) {
    if (!Number.isSafeInteger(v) || v < 0) return { error: 'bad_amount' };
  }
  const note = input.note?.trim() || null;
  if (note && [...note].length > 500) return { error: 'note_too_long' };
  return {
    id: uuidv7(),
    shop_id: ctx.shopId,
    business_date: input.businessDate,
    opening_cash_paisa: input.openingPaisa,
    expected_cash_paisa: input.expectedPaisa,
    counted_cash_paisa: input.countedPaisa,
    difference_paisa: input.countedPaisa - input.expectedPaisa,
    owner_withdrawal_paisa: input.withdrawalPaisa,
    note,
    closed_by_staff_id: ctx.staffId,
    closed_at: ctx.now.toISOString(),
    seen_through_seq: input.seenThroughSeq,
    device_id: ctx.deviceId,
    server_seq: null,
  };
}

// --- Rows not seen at closing ---

export interface SyncedRow {
  server_seq: number | null;
  device_id: string | null;
  created_at: string;
}

/** The closing device made it itself before closing: it was counted from its own Dexie. */
function countedLocally(row: SyncedRow, close: DayCloseRow): boolean {
  return (
    row.device_id !== null && row.device_id === close.device_id && row.created_at <= close.closed_at
  );
}

/**
 * "Not seen at closing": rows of the closed date with server_seq > seen_through_seq, except the
 * closing device's own rows made before closed_at. While the close or such rows have no
 * server_seq yet, the answer is not known ('waiting').
 */
export function rowsNotSeenAtClosing<T extends SyncedRow>(
  rows: readonly T[],
  close: DayCloseRow,
): { status: 'waiting' } | { status: 'checked'; rows: T[] } {
  if (close.server_seq === null) return { status: 'waiting' };
  const late: T[] = [];
  for (const row of rows) {
    if (countedLocally(row, close)) continue;
    if (row.server_seq === null) return { status: 'waiting' };
    if (row.server_seq > close.seen_through_seq) late.push(row);
  }
  return { status: 'checked', rows: late };
}

// --- Daily summary ---

export interface SummaryInput {
  close: DayCloseRow;
  sales: readonly SaleRow[];
  lines: readonly SaleLineRow[];
  /** Every payment of the date (sale and khata receipts). */
  payments: readonly PaymentRow[];
  khata: readonly KhataEntryRow[];
  expenses: readonly ExpenseRow[];
  movements: readonly StockMovementRow[];
  products: ReadonlyMap<string, { name: string; unit: UnitCode }>;
  /** Cost per unit at that date, only on owner devices (costs live there). */
  costs?: ReadonlyMap<string, Paisa> | undefined;
  categoryName: (id: string) => string;
  methodName: (code: string) => string;
  label: LabelFn;
  /** Shows the business date in the UI language ("23 نومبر 2026"); ISO when not given. */
  formatDate?: (isoDate: string) => string;
  shopName: string;
  paperWidthMm: PaperWidth;
  rtl: boolean;
}

export interface DaySummary {
  doc: ReceiptDoc;
  /** Expected cash recomputed from every row of the date now on this device. */
  expectedNowPaisa: Paisa;
  /** expectedNow − the stored expected cash ("Not included at closing"). */
  gapPaisa: Paisa;
  late:
    | { status: 'waiting' }
    | { status: 'checked'; count: number; cashPaisa: Paisa; byMethod: Map<string, Paisa> };
}

const sumBy = <T>(rows: readonly T[], key: (r: T) => string, value: (r: T) => number) => {
  const map = new Map<string, number>();
  for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + value(r));
  return map;
};

export function dailySummary(input: SummaryInput): DaySummary {
  const { close, label: L } = input;
  const rs = (p: number) =>
    p < 0
      ? `−${L('receipt.rs', { amount: rupeesText(-p) })}`
      : L('receipt.rs', { amount: rupeesText(p) });
  const qty = (milli: number, unit: UnitCode) => {
    const q = qtyLabel(milli, unit);
    return `${q.amount} ${isProductUnit(q.unit) ? L(`unit.${q.unit}`) : q.unit}`;
  };
  const out: ReceiptLine[] = [
    { kind: 'title', text: input.shopName },
    {
      kind: 'center',
      text: L('summary.title', { date: (input.formatDate ?? String)(close.business_date) }),
    },
    { kind: 'rule' },
  ];
  const pair = (label: string, value: string, strong = false) =>
    out.push({ kind: 'pair', label, value, ...(strong && { strong: true }) });

  // Sales
  const salesTotal = input.sales.reduce((s, x) => s + x.total_paisa, 0);
  pair(L('summary.sales', { count: String(input.sales.length) }), rs(salesTotal), true);
  const salePayments = input.payments.filter((p) => p.kind === 'sale');
  for (const [code, amount] of sumBy(
    salePayments,
    (p) => p.method_code,
    (p) => p.amount_paisa,
  )) {
    pair(`  ${input.methodName(code)}`, rs(amount));
  }
  const lineDiscounts = input.lines.reduce((s, l) => s + l.discount_paisa, 0);
  const billDiscounts = input.sales.reduce((s, x) => s + x.discount_paisa, 0);
  if (lineDiscounts + billDiscounts > 0)
    pair(L('summary.discounts'), rs(lineDiscounts + billDiscounts));
  const foc = input.lines
    .filter((l) => l.is_foc)
    .reduce((s, l) => s + priceForQty(l.qty_milli, l.unit_price_paisa), 0);
  if (foc > 0) pair(L('summary.foc'), rs(foc));

  // Khata
  const given = input.khata
    .filter((k) => k.type === 'credit_sale')
    .reduce((s, k) => s + k.amount_paisa, 0);
  const received = -input.khata
    .filter((k) => k.type === 'payment')
    .reduce((s, k) => s + k.amount_paisa, 0);
  if (given || received) {
    out.push({ kind: 'rule' });
    pair(L('summary.khataGiven'), rs(given));
    pair(L('summary.khataReceived'), rs(received));
  }

  // Expenses (reversals netted)
  if (input.expenses.length) {
    out.push({ kind: 'rule' });
    const byCat = sumBy(
      input.expenses,
      (e) => e.category_id,
      (e) => e.amount_paisa,
    );
    const total = input.expenses.reduce((s, e) => s + e.amount_paisa, 0);
    pair(L('summary.expenses'), rs(total), true);
    for (const [id, amount] of byCat)
      if (amount !== 0) pair(`  ${input.categoryName(id)}`, rs(amount));
  }

  // Wastage: quantities; value only where costs are known (owner devices)
  const waste = input.movements.filter((m) => m.reason === 'wastage' || m.reason === 'damaged');
  if (waste.length) {
    out.push({ kind: 'rule' });
    let value = 0;
    pair(L('summary.wastage'), '');
    for (const [productId, milli] of sumBy(
      waste,
      (m) => m.product_id,
      (m) => -m.qty_milli,
    )) {
      const p = input.products.get(productId);
      if (!p) continue;
      const cost = input.costs?.get(productId);
      if (cost !== undefined) value += priceForQty(milli, cost);
      pair(`  ${p.name}`, qty(milli, p.unit));
    }
    if (input.costs) pair(L('summary.wastageValue'), rs(value));
  }

  // Cash
  out.push({ kind: 'rule' });
  const expectedNow = expectedCash({
    openingPaisa: close.opening_cash_paisa,
    payments: input.payments,
    expenses: input.expenses,
    withdrawalPaisa: close.owner_withdrawal_paisa,
  });
  pair(L('summary.opening'), rs(close.opening_cash_paisa));
  if (close.owner_withdrawal_paisa) pair(L('summary.withdrawal'), rs(close.owner_withdrawal_paisa));
  pair(L('summary.expected'), rs(close.expected_cash_paisa));
  pair(L('summary.counted'), rs(close.counted_cash_paisa));
  pair(
    close.difference_paisa < 0
      ? L('summary.short')
      : close.difference_paisa > 0
        ? L('summary.over')
        : L('summary.exact'),
    rs(Math.abs(close.difference_paisa)),
    true,
  );
  const gap = expectedNow - close.expected_cash_paisa;
  if (gap !== 0) {
    pair(L('summary.expectedNow'), rs(expectedNow));
    pair(L('summary.gap'), rs(gap), true);
  }

  // Rows not seen at closing
  const rows = [
    ...input.sales.map((r) => ({
      ...r,
      cash: 0,
      total: r.total_paisa,
      method: null as string | null,
    })),
    ...input.payments.map((p) => ({
      ...p,
      cash: p.method_code === 'cash' ? (CASH_IN.has(p.kind) ? p.amount_paisa : -p.amount_paisa) : 0,
      total: 0,
      method: p.method_code,
    })),
    ...input.expenses.map((e) => ({
      ...e,
      cash: e.paid_method_code === 'cash' ? -e.amount_paisa : 0,
      total: 0,
      method: null as string | null,
    })),
  ];
  const lateCheck = rowsNotSeenAtClosing(rows, close);
  let late: DaySummary['late'];
  if (lateCheck.status === 'waiting') {
    late = { status: 'waiting' };
    out.push({ kind: 'center', text: L('summary.waiting') });
  } else {
    const byMethod = sumBy(
      lateCheck.rows.filter((r) => r.method),
      (r) => r.method!,
      (r) => (r as { amount_paisa: number }).amount_paisa,
    );
    const lateSales = lateCheck.rows.filter((r) => 'receipt_no' in r).length;
    const cash = lateCheck.rows.reduce((s, r) => s + r.cash, 0);
    late = { status: 'checked', count: lateCheck.rows.length, cashPaisa: cash, byMethod };
    if (lateCheck.rows.length) {
      out.push({ kind: 'rule' });
      pair(
        L('summary.late', { count: String(lateCheck.rows.length), sales: String(lateSales) }),
        rs(cash),
        true,
      );
      for (const [code, amount] of byMethod) pair(`  ${input.methodName(code)}`, rs(amount));
    }
  }
  if (close.note) {
    out.push({ kind: 'rule' });
    out.push({ kind: 'center', text: close.note });
  }
  out.push({
    kind: 'center',
    text: L('summary.closedAt', { at: receiptDateTime(close.closed_at) }),
  });
  return {
    doc: {
      language: input.rtl ? 'ur' : 'en',
      dir: input.rtl ? 'rtl' : 'ltr',
      paperWidthMm: input.paperWidthMm,
      lines: out,
    },
    expectedNowPaisa: expectedNow,
    gapPaisa: gap,
    late,
  };
}
