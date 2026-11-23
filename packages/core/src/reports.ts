// Owner reports (US047, US048, US049, US068; architecture §3 "Reports", §5). The server computes
// reports with SQL functions over every device's data (report_summary, report_products,
// report_staff, report_expenses); these pure functions are the same formulas, kept in step with
// SQL through the shared fixture fixtures/report-month.json, and used by the app for the P&L
// layout, date ranges and CSV.
//
// Rules (decided 23 Nov 2026):
// - Cost of goods: per sale line with a product, qty × the cost in effect at the sale's created_at
//   (latest product_cost_history row with effective_at ≤ created_at). FOC lines add their cost;
//   by_amount lines use their qty. Lines without a known cost (no history, custom items) are
//   "sales without a cost price": counted in sales, never in profit.
// - A line's net sales = its line total (after its own discount) + its share of the sale's bill
//   adjustment (rounding − bill discount), shared in proportion to line totals with cumulative
//   rounding, so the shares of one sale add up exactly.
// - Profit on items with a cost price = net sales of costed lines − their cost of goods.
//   Net = that profit − expenses (net of reversals) − wastage value, "excluding sales without a
//   cost price" when there are any.
// - Wastage / damaged value = |qty| × cost in effect at the movement's created_at; shown
//   separately, never inside cost of goods.
// - Monthly = calendar month by business_date. Earlier days with activity and no day close are
//   "unclosed"; today (in range, not closed) is "still open".
import { mulDivRound } from './fixed.ts';
import type { Paisa } from './money.ts';
import type { QtyMilli } from './qty.ts';

/** Longest range a report covers (days, inclusive). */
export const MAX_REPORT_DAYS = 366;

// --- Dates (business dates, "YYYY-MM-DD") ---

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromTime = (time: number) => new Date(time).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromTime(toTime(date) + days * DAY_MS);
}

/** Days from..to inclusive (1 for a single day). */
export function daysInRange(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS) + 1;
}

export type ReportRangeError = 'bad_date' | 'from_after_to' | 'too_long';

export function validateRange(from: string, to: string): ReportRangeError | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to) || Number.isNaN(toTime(from)) || Number.isNaN(toTime(to)))
    return 'bad_date';
  if (from > to) return 'from_after_to';
  if (daysInRange(from, to) > MAX_REPORT_DAYS) return 'too_long';
  return null;
}

export const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;

export function lastOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return fromTime(Date.UTC(y, m, 0));
}

/** The comparison period: the previous calendar month for a whole month, else the same length just before. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  if (from === firstOfMonth(from) && to === lastOfMonth(from)) {
    const prevLast = addDays(from, -1);
    return { from: firstOfMonth(prevLast), to: prevLast };
  }
  const length = daysInRange(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

export const RANGE_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'last_month',
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** A preset range around `today` (the shop's business date). Weeks start on Monday. */
export function rangePreset(preset: RangePreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case 'this_week': {
      const weekday = (new Date(toTime(today)).getUTCDay() + 6) % 7; // Monday = 0
      return { from: addDays(today, -weekday), to: today };
    }
    case 'this_month':
      return { from: firstOfMonth(today), to: today };
    case 'last_month': {
      const prev = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(prev), to: prev };
    }
  }
}

// --- Input rows (the columns the reports read) ---

export interface ReportSale {
  id: string;
  business_date: string;
  staff_id: string;
  customer_id?: string | null;
  subtotal_paisa: Paisa;
  discount_paisa: Paisa;
  rounding_paisa: Paisa;
  total_paisa: Paisa;
  created_at: string;
}
export interface ReportSaleLine {
  id: string;
  sale_id: string;
  product_id: string | null;
  name_snapshot: string;
  name_ur_snapshot?: string | null;
  unit_snapshot: string;
  qty_milli: QtyMilli;
  unit_price_paisa: Paisa;
  discount_paisa: Paisa;
  is_foc: boolean;
  by_amount?: boolean;
  line_total_paisa: Paisa;
}
export interface ReportPayment {
  business_date: string;
  kind: string;
  method_code: string;
  amount_paisa: Paisa;
}
export interface ReportKhataEntry {
  customer_id: string;
  business_date: string;
  type: string;
  amount_paisa: Paisa;
}
export interface ReportStockMovement {
  product_id: string;
  business_date: string;
  qty_milli: QtyMilli;
  reason: string;
  created_at: string;
}
export interface ReportExpense {
  id: string;
  business_date: string;
  category_id: string;
  amount_paisa: Paisa;
  paid_method_code: string;
  staff_id: string;
  note?: string | null;
  payee?: string | null;
  reverses_expense_id?: string | null;
  reversal_reason?: string | null;
  created_at: string;
}
export interface ReportCostRow {
  id: string;
  product_id: string;
  cost_price_paisa: Paisa;
  effective_at: string;
}
export interface ReportInput {
  sales: readonly ReportSale[];
  lines: readonly ReportSaleLine[];
  payments: readonly ReportPayment[];
  khata: readonly ReportKhataEntry[];
  movements: readonly ReportStockMovement[];
  expenses: readonly ReportExpense[];
  costs: readonly ReportCostRow[];
  /** Business dates with a day close. */
  closedDates: readonly string[];
  products?: readonly { id: string; name: string; name_ur: string | null; unit: string }[];
  categories?: readonly {
    id: string;
    name: string;
    name_ur: string | null;
    i18n_key: string | null;
  }[];
  staff?: readonly { id: string; name: string }[];
}

// --- Cost at a time ---

/** The cost in effect at `at`: the latest row with effective_at ≤ at (ties: the later id). */
export function costAt(
  costs: readonly ReportCostRow[],
  productId: string | null,
  at: string,
): Paisa | null {
  if (!productId) return null;
  const when = Date.parse(at);
  let best: ReportCostRow | null = null;
  for (const c of costs) {
    if (c.product_id !== productId || Date.parse(c.effective_at) > when) continue;
    if (
      !best ||
      Date.parse(c.effective_at) > Date.parse(best.effective_at) ||
      (c.effective_at === best.effective_at && c.id > best.id)
    )
      best = c;
  }
  return best ? best.cost_price_paisa : null;
}

/** qty × cost per unit, half away from zero (same as priceForQty and SQL round()). */
export const lineCost = (qtyMilli: QtyMilli, costPaisa: Paisa): Paisa =>
  mulDivRound(Math.abs(qtyMilli), costPaisa, 1000);

// --- Lines with net sales and cost ---

export interface ValuedLine extends ReportSaleLine {
  sale: ReportSale;
  /** Line total + its share of the bill adjustment. */
  net_paisa: Paisa;
  /** null = no cost price known at sale time. */
  cost_paisa: Paisa | null;
}

/** Lines of the given sales with net sales (bill adjustment shared) and cost at sale time. */
export function valueLines(
  sales: readonly ReportSale[],
  lines: readonly ReportSaleLine[],
  costs: readonly ReportCostRow[],
): ValuedLine[] {
  const bySale = new Map<string, ReportSaleLine[]>();
  for (const l of lines) bySale.set(l.sale_id, [...(bySale.get(l.sale_id) ?? []), l]);
  const out: ValuedLine[] = [];
  // Oldest sale first, so "the first line" of a custom item (its name and unit) is the same as SQL.
  const ordered = [...sales].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1,
  );
  for (const sale of ordered) {
    const own = [...(bySale.get(sale.id) ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
    const base = own.reduce((s, l) => s + l.line_total_paisa, 0);
    const adjust = sale.rounding_paisa - sale.discount_paisa;
    let cumulative = 0;
    for (const l of own) {
      const before = cumulative;
      cumulative += l.line_total_paisa;
      const share =
        base === 0 ? 0 : mulDivRound(adjust, cumulative, base) - mulDivRound(adjust, before, base);
      const cost = costAt(costs, l.product_id, sale.created_at);
      out.push({
        ...l,
        sale,
        net_paisa: l.line_total_paisa + share,
        cost_paisa: cost === null ? null : lineCost(l.qty_milli, cost),
      });
    }
  }
  return out;
}

// --- Summary (report_summary) ---

export interface AmountBy {
  key: string;
  amount_paisa: Paisa;
}

export interface ReportSummary {
  from: string;
  to: string;
  sales_count: number;
  gross_sales_paisa: Paisa;
  line_discount_paisa: Paisa;
  bill_discount_paisa: Paisa;
  rounding_paisa: Paisa;
  net_sales_paisa: Paisa;
  payments_by_method: AmountBy[];
  khata_receipts_by_method: AmountBy[];
  khata_given_paisa: Paisa;
  khata_received_paisa: Paisa;
  foc_lines: number;
  foc_value_paisa: Paisa;
  costed_sales_paisa: Paisa;
  cost_of_goods_paisa: Paisa;
  costed_profit_paisa: Paisa;
  uncosted_sales_paisa: Paisa;
  uncosted_lines: number;
  uncosted_products: number;
  expenses_total_paisa: Paisa;
  expenses_by_category: (AmountBy & {
    name: string | null;
    name_ur: string | null;
    i18n_key: string | null;
  })[];
  wastage_value_paisa: Paisa;
  wastage_unvalued_lines: number;
  net_paisa: Paisa;
  receivables_paisa: Paisa;
  receivable_customers: number;
  unclosed_days: string[];
  today_open: boolean;
}

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;

/** Sorted by amount (largest first), then key; zero totals left out. */
function grouped(pairs: Iterable<[string, Paisa]>): AmountBy[] {
  const map = new Map<string, Paisa>();
  for (const [k, v] of pairs) map.set(k, (map.get(k) ?? 0) + v);
  return [...map]
    .filter(([, v]) => v !== 0)
    .map(([key, amount_paisa]) => ({ key, amount_paisa }))
    .sort((a, b) => b.amount_paisa - a.amount_paisa || (a.key < b.key ? -1 : 1));
}

const productKey = (l: ReportSaleLine) =>
  l.product_id ?? `custom:${l.name_snapshot.trim().toLowerCase()}`;

export function reportSummary(
  input: ReportInput,
  from: string,
  to: string,
  today: string,
): ReportSummary {
  const sales = input.sales.filter((s) => inRange(s.business_date, from, to));
  const valued = valueLines(sales, input.lines, input.costs);
  const costed = valued.filter((l) => l.cost_paisa !== null);
  const uncosted = valued.filter((l) => l.cost_paisa === null);
  const costedSales = costed.reduce((s, l) => s + l.net_paisa, 0);
  const cogs = costed.reduce((s, l) => s + (l.cost_paisa ?? 0), 0);

  const payments = input.payments.filter((p) => inRange(p.business_date, from, to));
  const khata = input.khata.filter((k) => inRange(k.business_date, from, to));
  const expenses = input.expenses.filter((e) => inRange(e.business_date, from, to));
  const categories = new Map((input.categories ?? []).map((c) => [c.id, c]));

  let wastage = 0;
  let unvalued = 0;
  for (const m of input.movements) {
    if (!inRange(m.business_date, from, to)) continue;
    if (m.reason !== 'wastage' && m.reason !== 'damaged') continue;
    const cost = costAt(input.costs, m.product_id, m.created_at);
    if (cost === null) unvalued++;
    else wastage += lineCost(m.qty_milli, cost);
  }

  const balances = new Map<string, Paisa>();
  for (const k of input.khata)
    if (k.business_date <= to)
      balances.set(k.customer_id, (balances.get(k.customer_id) ?? 0) + k.amount_paisa);
  const owing = [...balances.values()].filter((b) => b > 0);

  const expensesByCategory = grouped(expenses.map((e) => [e.category_id, e.amount_paisa]));
  const expensesTotal = expenses.reduce((s, e) => s + e.amount_paisa, 0);
  const costedProfit = costedSales - cogs;

  return {
    from,
    to,
    sales_count: sales.length,
    gross_sales_paisa: valued.reduce((s, l) => s + l.line_total_paisa + l.discount_paisa, 0),
    line_discount_paisa: valued.reduce((s, l) => s + l.discount_paisa, 0),
    bill_discount_paisa: sales.reduce((s, x) => s + x.discount_paisa, 0),
    rounding_paisa: sales.reduce((s, x) => s + x.rounding_paisa, 0),
    net_sales_paisa: sales.reduce((s, x) => s + x.total_paisa, 0),
    payments_by_method: grouped(
      payments.filter((p) => p.kind === 'sale').map((p) => [p.method_code, p.amount_paisa]),
    ),
    khata_receipts_by_method: grouped(
      payments
        .filter((p) => p.kind === 'khata_receipt')
        .map((p) => [p.method_code, p.amount_paisa]),
    ),
    khata_given_paisa: khata
      .filter((k) => k.type === 'credit_sale')
      .reduce((s, k) => s + k.amount_paisa, 0),
    khata_received_paisa: -khata
      .filter((k) => k.type === 'payment')
      .reduce((s, k) => s + k.amount_paisa, 0),
    foc_lines: valued.filter((l) => l.is_foc).length,
    foc_value_paisa: valued
      .filter((l) => l.is_foc)
      .reduce((s, l) => s + mulDivRound(l.qty_milli, l.unit_price_paisa, 1000), 0),
    costed_sales_paisa: costedSales,
    cost_of_goods_paisa: cogs,
    costed_profit_paisa: costedProfit,
    uncosted_sales_paisa: uncosted.reduce((s, l) => s + l.net_paisa, 0),
    uncosted_lines: uncosted.length,
    uncosted_products: new Set(uncosted.map(productKey)).size,
    expenses_total_paisa: expensesTotal,
    expenses_by_category: expensesByCategory.map((e) => {
      const c = categories.get(e.key);
      return {
        ...e,
        name: c?.name ?? null,
        name_ur: c?.name_ur ?? null,
        i18n_key: c?.i18n_key ?? null,
      };
    }),
    wastage_value_paisa: wastage,
    wastage_unvalued_lines: unvalued,
    net_paisa: costedProfit - expensesTotal - wastage,
    receivables_paisa: owing.reduce((s, b) => s + b, 0),
    receivable_customers: owing.length,
    ...openDays(input, from, to, today),
  };
}

/** Earlier days with activity and no close; today (in range and not closed) is "still open". */
export function openDays(
  input: Pick<
    ReportInput,
    'sales' | 'payments' | 'khata' | 'movements' | 'expenses' | 'closedDates'
  >,
  from: string,
  to: string,
  today: string,
): { unclosed_days: string[]; today_open: boolean } {
  const closed = new Set(input.closedDates);
  const active = new Set<string>();
  for (const rows of [input.sales, input.payments, input.khata, input.movements, input.expenses])
    for (const r of rows) active.add(r.business_date);
  const unclosed = [...active]
    .filter((d) => inRange(d, from, to) && d < today && !closed.has(d))
    .sort();
  return { unclosed_days: unclosed, today_open: inRange(today, from, to) && !closed.has(today) };
}

// --- Products (report_products) ---

export interface ProductReportRow {
  key: string;
  product_id: string | null;
  name: string;
  name_ur: string | null;
  unit: string;
  custom: boolean;
  lines: number;
  qty_milli: QtyMilli;
  foc_qty_milli: QtyMilli;
  sales_paisa: Paisa;
  costed_sales_paisa: Paisa;
  cost_paisa: Paisa;
  profit_paisa: Paisa;
  uncosted_sales_paisa: Paisa;
}

/** Per product (custom items grouped by name, flagged), by sales value. */
export function productReport(input: ReportInput, from: string, to: string): ProductReportRow[] {
  const sales = input.sales.filter((s) => inRange(s.business_date, from, to));
  const products = new Map((input.products ?? []).map((p) => [p.id, p]));
  const rows = new Map<string, ProductReportRow>();
  for (const l of valueLines(sales, input.lines, input.costs)) {
    const key = productKey(l);
    const p = l.product_id ? products.get(l.product_id) : undefined;
    const row = rows.get(key) ?? {
      key,
      product_id: l.product_id,
      name: p?.name ?? l.name_snapshot.trim(),
      name_ur: p ? p.name_ur : (l.name_ur_snapshot ?? null),
      unit: p?.unit ?? l.unit_snapshot,
      custom: l.product_id === null,
      lines: 0,
      qty_milli: 0,
      foc_qty_milli: 0,
      sales_paisa: 0,
      costed_sales_paisa: 0,
      cost_paisa: 0,
      profit_paisa: 0,
      uncosted_sales_paisa: 0,
    };
    row.lines++;
    row.qty_milli += l.qty_milli;
    if (l.is_foc) row.foc_qty_milli += l.qty_milli;
    row.sales_paisa += l.net_paisa;
    if (l.cost_paisa === null) row.uncosted_sales_paisa += l.net_paisa;
    else {
      row.costed_sales_paisa += l.net_paisa;
      row.cost_paisa += l.cost_paisa;
      row.profit_paisa += l.net_paisa - l.cost_paisa;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.sales_paisa - a.sales_paisa || (a.key < b.key ? -1 : 1),
  );
}

// --- Staff (report_staff) ---

export interface StaffReportRow {
  staff_id: string;
  name: string;
  sales_count: number;
  sales_paisa: Paisa;
  discount_paisa: Paisa;
  foc_value_paisa: Paisa;
}

export function staffReport(input: ReportInput, from: string, to: string): StaffReportRow[] {
  const names = new Map((input.staff ?? []).map((s) => [s.id, s.name]));
  const linesBySale = new Map<string, ReportSaleLine[]>();
  for (const l of input.lines)
    linesBySale.set(l.sale_id, [...(linesBySale.get(l.sale_id) ?? []), l]);
  const rows = new Map<string, StaffReportRow>();
  for (const s of input.sales) {
    if (!inRange(s.business_date, from, to)) continue;
    const row = rows.get(s.staff_id) ?? {
      staff_id: s.staff_id,
      name: names.get(s.staff_id) ?? '',
      sales_count: 0,
      sales_paisa: 0,
      discount_paisa: 0,
      foc_value_paisa: 0,
    };
    const lines = linesBySale.get(s.id) ?? [];
    row.sales_count++;
    row.sales_paisa += s.total_paisa;
    row.discount_paisa += s.discount_paisa + lines.reduce((x, l) => x + l.discount_paisa, 0);
    row.foc_value_paisa += lines
      .filter((l) => l.is_foc)
      .reduce((x, l) => x + mulDivRound(l.qty_milli, l.unit_price_paisa, 1000), 0);
    rows.set(s.staff_id, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.sales_paisa - a.sales_paisa || (a.staff_id < b.staff_id ? -1 : 1),
  );
}

// --- Expenses (report_expenses) ---

export interface ExpenseFilters {
  category_id?: string;
  method_code?: string;
  staff_id?: string;
}

export interface ExpenseReport {
  from: string;
  to: string;
  lines: ReportExpense[];
  total_paisa: Paisa;
  by_category: AmountBy[];
  by_method: AmountBy[];
  previous: { from: string; to: string; total_paisa: Paisa; by_category: AmountBy[] };
}

export function expenseReport(
  input: Pick<ReportInput, 'expenses'>,
  from: string,
  to: string,
  filters: ExpenseFilters = {},
): ExpenseReport {
  const match = (e: ReportExpense) =>
    (!filters.category_id || e.category_id === filters.category_id) &&
    (!filters.method_code || e.paid_method_code === filters.method_code) &&
    (!filters.staff_id || e.staff_id === filters.staff_id);
  const lines = input.expenses
    .filter((e) => inRange(e.business_date, from, to) && match(e))
    .sort(
      (a, b) =>
        (a.business_date < b.business_date ? 1 : a.business_date > b.business_date ? -1 : 0) ||
        (a.created_at < b.created_at ? 1 : -1),
    );
  const prev = previousPeriod(from, to);
  const prevLines = input.expenses.filter(
    (e) => inRange(e.business_date, prev.from, prev.to) && match(e),
  );
  return {
    from,
    to,
    lines,
    total_paisa: lines.reduce((s, e) => s + e.amount_paisa, 0),
    by_category: grouped(lines.map((e) => [e.category_id, e.amount_paisa])),
    by_method: grouped(lines.map((e) => [e.paid_method_code, e.amount_paisa])),
    previous: {
      ...prev,
      total_paisa: prevLines.reduce((s, e) => s + e.amount_paisa, 0),
      by_category: grouped(prevLines.map((e) => [e.category_id, e.amount_paisa])),
    },
  };
}

// --- Profit and loss layout (US047) ---

export interface PnlLine {
  key:
    | 'gross_sales'
    | 'discounts'
    | 'rounding'
    | 'net_sales'
    | 'uncosted_sales'
    | 'costed_sales'
    | 'cost_of_goods'
    | 'gross_profit'
    | 'expense'
    | 'expenses_total'
    | 'wastage'
    | 'net';
  amount_paisa: Paisa;
  /** Expense category for 'expense' lines. */
  category?: { key: string; name: string | null; name_ur: string | null; i18n_key: string | null };
}

/**
 * The monthly P&L: Sales − Discounts ± Rounding = Net sales; of which sales without a cost price
 * (shown apart) and costed sales − cost of goods = gross profit (costed items); − expenses by
 * category; − wastage value; = net (excluding sales without a cost price when there are any).
 */
export function profitAndLoss(s: ReportSummary): {
  lines: PnlLine[];
  excludesUncosted: boolean;
} {
  const lines: PnlLine[] = [
    { key: 'gross_sales', amount_paisa: s.gross_sales_paisa },
    { key: 'discounts', amount_paisa: -(s.line_discount_paisa + s.bill_discount_paisa) },
    { key: 'rounding', amount_paisa: s.rounding_paisa },
    { key: 'net_sales', amount_paisa: s.net_sales_paisa },
    { key: 'uncosted_sales', amount_paisa: s.uncosted_sales_paisa },
    { key: 'costed_sales', amount_paisa: s.costed_sales_paisa },
    { key: 'cost_of_goods', amount_paisa: -s.cost_of_goods_paisa },
    { key: 'gross_profit', amount_paisa: s.costed_profit_paisa },
    ...s.expenses_by_category.map((e): PnlLine => ({
      key: 'expense',
      amount_paisa: -e.amount_paisa,
      category: { key: e.key, name: e.name, name_ur: e.name_ur, i18n_key: e.i18n_key },
    })),
    { key: 'expenses_total', amount_paisa: -s.expenses_total_paisa },
    { key: 'wastage', amount_paisa: -s.wastage_value_paisa },
    { key: 'net', amount_paisa: s.net_paisa },
  ];
  return { lines, excludesUncosted: s.uncosted_sales_paisa !== 0 || s.uncosted_lines > 0 };
}

// --- CSV (same output from the API's ?format=csv and the app's offline export) ---

/** RFC 4180 CSV with a UTF-8 BOM (Excel then shows Urdu correctly) and CRLF line ends. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    const text = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Paisa → "1234.50" (no separators, for spreadsheets). */
export const csvRupees = (paisa: Paisa) => {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
/** qty_milli → "1.500". */
export const csvQty = (qty: QtyMilli) => {
  const sign = qty < 0 ? '-' : '';
  const abs = Math.abs(qty);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
};

export function productsCsv(rows: readonly ProductReportRow[]): string {
  return toCsv([
    [
      'product',
      'name_ur',
      'unit',
      'custom_item',
      'qty',
      'free_qty',
      'sales',
      'sales_with_cost_price',
      'cost_of_goods',
      'profit',
      'sales_without_cost_price',
    ],
    ...rows.map((r) => [
      r.name,
      r.name_ur,
      r.unit,
      r.custom ? 'yes' : 'no',
      csvQty(r.qty_milli),
      csvQty(r.foc_qty_milli),
      csvRupees(r.sales_paisa),
      csvRupees(r.costed_sales_paisa),
      csvRupees(r.cost_paisa),
      csvRupees(r.profit_paisa),
      csvRupees(r.uncosted_sales_paisa),
    ]),
  ]);
}

export function staffCsv(rows: readonly StaffReportRow[]): string {
  return toCsv([
    ['staff', 'sales_count', 'sales', 'discounts_given', 'free_items_value'],
    ...rows.map((r) => [
      r.name,
      r.sales_count,
      csvRupees(r.sales_paisa),
      csvRupees(r.discount_paisa),
      csvRupees(r.foc_value_paisa),
    ]),
  ]);
}

export function expensesCsv(
  lines: readonly (ReportExpense & { category_name?: string | null; staff_name?: string | null })[],
): string {
  return toCsv([
    ['date', 'category', 'amount', 'method', 'note', 'payee', 'staff', 'reversal_of', 'reason'],
    ...lines.map((e) => [
      e.business_date,
      e.category_name ?? e.category_id,
      csvRupees(e.amount_paisa),
      e.paid_method_code,
      e.note,
      e.payee,
      e.staff_name ?? e.staff_id,
      e.reverses_expense_id,
      e.reversal_reason,
    ]),
  ]);
}

/** The monthly P&L as CSV (labels in English). */
export function pnlCsv(s: ReportSummary): string {
  const { lines, excludesUncosted } = profitAndLoss(s);
  const label: Record<PnlLine['key'], string> = {
    gross_sales: 'Sales',
    discounts: 'Discounts',
    rounding: 'Rounding',
    net_sales: 'Net sales',
    uncosted_sales: 'Sales without cost price',
    costed_sales: 'Sales with cost price',
    cost_of_goods: 'Cost of goods',
    gross_profit: 'Gross profit (items with a cost price)',
    expense: 'Expense',
    expenses_total: 'Expenses total',
    wastage: 'Wastage value',
    net: excludesUncosted ? 'Net (excluding sales without cost price)' : 'Net',
  };
  return toCsv([
    ['line', 'amount'],
    ...lines.map((l) => [
      l.key === 'expense' ? `Expense: ${l.category?.name ?? l.category?.key ?? ''}` : label[l.key],
      csvRupees(l.amount_paisa),
    ]),
    ['Receivables at period end', csvRupees(s.receivables_paisa)],
  ]);
}
