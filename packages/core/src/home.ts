// Home screen numbers (design-theme.md "Screens → Home"). Pure; the app passes Dexie rows, so
// Home works offline. "Today" is the current business date (businessDateFor), the same date new
// sales get, so after a close Home shows the next day's sales.
import type { KhataEntryRow } from './khata.ts';
import { nextDate } from './sale.ts';
import type { PaymentRow, SaleRow } from './sale.ts';
import type { ProductRow } from './catalogue.ts';
import type { StockMovementRow } from './stock.ts';
import { stockByProduct } from './stock.ts';
import type { Paisa } from './money.ts';

export interface TodayTotals {
  total_paisa: Paisa;
  invoices: number;
  /** Cash payments of those sales. */
  cash_paisa: Paisa;
  /** Wallets, bank and any other payment method. */
  other_paisa: Paisa;
  /** The part put on customers' khata (credit_sale entries). */
  khata_paisa: Paisa;
}

/** Totals for one business date; with staffId, only that person's sales (cashiers). */
export function todayTotals(
  sales: readonly Pick<SaleRow, 'id' | 'business_date' | 'staff_id' | 'total_paisa'>[],
  payments: readonly Pick<PaymentRow, 'sale_id' | 'kind' | 'method_code' | 'amount_paisa'>[],
  khata: readonly Pick<KhataEntryRow, 'sale_id' | 'type' | 'amount_paisa'>[],
  options: { date: string; staffId?: string | null | undefined },
): TodayTotals {
  const mine = sales.filter(
    (s) => s.business_date === options.date && (!options.staffId || s.staff_id === options.staffId),
  );
  const ids = new Set(mine.map((s) => s.id));
  let cash = 0;
  let other = 0;
  for (const p of payments) {
    if (p.kind !== 'sale' || !p.sale_id || !ids.has(p.sale_id)) continue;
    if (p.method_code === 'cash') cash += p.amount_paisa;
    else other += p.amount_paisa;
  }
  let onKhata = 0;
  for (const k of khata) {
    if (k.type === 'credit_sale' && k.sale_id && ids.has(k.sale_id)) onKhata += k.amount_paisa;
  }
  return {
    total_paisa: mine.reduce((sum, s) => sum + s.total_paisa, 0),
    invoices: mine.length,
    cash_paisa: cash,
    other_paisa: other,
    khata_paisa: onKhata,
  };
}

export interface TrendDay {
  date: string;
  total_paisa: Paisa;
  isToday: boolean;
}

/** Seven business dates ending at `today`, oldest first; empty days are 0. */
export function sevenDayTrend(
  sales: readonly Pick<SaleRow, 'business_date' | 'total_paisa'>[],
  today: string,
): { days: TrendDay[]; max_paisa: Paisa } {
  const dates: string[] = [];
  let d = today;
  for (let i = 0; i < 6; i++) d = previousDate(d);
  for (let i = 0; i < 7; i++) {
    dates.push(d);
    d = nextDate(d);
  }
  const totals = new Map(dates.map((x) => [x, 0]));
  for (const s of sales) {
    if (totals.has(s.business_date))
      totals.set(s.business_date, totals.get(s.business_date)! + s.total_paisa);
  }
  const days = dates.map((date) => ({
    date,
    total_paisa: totals.get(date)!,
    isToday: date === today,
  }));
  return { days, max_paisa: Math.max(0, ...days.map((x) => x.total_paisa)) };
}

function previousDate(date: string): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** What customers owe the shop: the sum of positive balances (the khata list total). */
export function receivableTotal(
  entries: readonly Pick<KhataEntryRow, 'customer_id' | 'amount_paisa'>[],
): Paisa {
  const balances = new Map<string, number>();
  for (const e of entries)
    balances.set(e.customer_id, (balances.get(e.customer_id) ?? 0) + e.amount_paisa);
  let total = 0;
  for (const b of balances.values()) if (b > 0) total += b;
  return total;
}

/** "Low stock" until minimum quantities exist (R2): tracked, not hidden, stock ≤ 0. */
export function lowStockCount(
  products: readonly Pick<ProductRow, 'id' | 'track_stock' | 'deleted_at'>[],
  movements: readonly Pick<StockMovementRow, 'product_id' | 'qty_milli'>[],
): number {
  const stock = stockByProduct(movements);
  return products.filter(
    (p) => p.track_stock && p.deleted_at === null && (stock.get(p.id) ?? 0) <= 0,
  ).length;
}

export type RecentItem =
  | {
      kind: 'sale';
      id: string;
      at: string;
      amount_paisa: Paisa;
      receipt_no: string;
      customer_id: string | null;
    }
  | {
      kind: 'khata';
      id: string;
      at: string;
      amount_paisa: Paisa;
      type: KhataEntryRow['type'];
      customer_id: string;
    };

/** The latest sales and khata entries, newest first. */
export function recentActivity(
  sales: readonly Pick<
    SaleRow,
    'id' | 'created_at' | 'total_paisa' | 'receipt_no' | 'customer_id'
  >[],
  khata: readonly Pick<
    KhataEntryRow,
    'id' | 'created_at' | 'amount_paisa' | 'type' | 'customer_id'
  >[],
  limit = 5,
): RecentItem[] {
  const items: RecentItem[] = [
    ...sales.map((s) => ({
      kind: 'sale' as const,
      id: s.id,
      at: s.created_at,
      amount_paisa: s.total_paisa,
      receipt_no: s.receipt_no,
      customer_id: s.customer_id,
    })),
    // A sale's own credit entry is already shown by the sale.
    ...khata
      .filter((k) => k.type !== 'credit_sale')
      .map((k) => ({
        kind: 'khata' as const,
        id: k.id,
        at: k.created_at,
        amount_paisa: k.amount_paisa,
        type: k.type,
        customer_id: k.customer_id,
      })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, limit);
}
