import type { PaymentRow, SaleLineRow, SaleRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema.ts';

export interface SaleBundle {
  sale: SaleRow;
  lines: SaleLineRow[];
  payments: PaymentRow[];
}

/** A sale with its lines and payments, from Dexie (undefined while loading, null if absent). */
export function useSaleBundle(saleId: string | undefined): SaleBundle | null | undefined {
  return useLiveQuery(async () => {
    if (!saleId) return null;
    const sale = await db.sales.get(saleId);
    if (!sale) return null;
    const [lines, payments] = await Promise.all([
      db.sale_lines.where('sale_id').equals(saleId).toArray(),
      db.payments.where('sale_id').equals(saleId).toArray(),
    ]);
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    return { sale, lines: lines.sort(byId), payments: payments.sort(byId) };
  }, [saleId]);
}

/**
 * The shop's sales on these business dates, newest first (Sales screen). One single-field
 * equals() on business_date per day, sequential: Dexie runs each as getAll() with no cursor,
 * which iOS WebKit always allows (bug 2026-11-25). At most 31 days (SALES_MAX_DAYS).
 */
export async function readSalesOn(days: readonly string[], shopId: string): Promise<SaleRow[]> {
  const sales: SaleRow[] = [];
  for (const day of days) {
    for (const sale of await db.sales.where('business_date').equals(day).toArray()) {
      if (sale.shop_id === shopId) sales.push(sale);
    }
  }
  // UUIDv7 ids sort by creation time.
  return sales.sort((a, b) => b.id.localeCompare(a.id));
}
