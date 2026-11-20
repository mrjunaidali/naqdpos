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
