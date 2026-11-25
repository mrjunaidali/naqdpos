// Stock read from Dexie (US024): always the sum of the product's movements (packages/core).
import { stockByProduct, stockOf, type UnitCode } from '@naqdpos/core';
import { unitName } from '../sale/saleFormat.ts';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { useQtyText } from '../sale/saleFormat.ts';

/** Stock of every product with movements on this device; a missing product has 0. */
export function useStockByProduct(): Map<string, number> | undefined {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return new Map<string, number>();
    return stockByProduct(
      await db.stock_movements.where('shop_id').equals(device.shop_id).toArray(),
    );
  });
}

export function useProductStock(productId: string | undefined): number | undefined {
  return useLiveQuery(
    async () =>
      productId
        ? stockOf(await db.stock_movements.where('product_id').equals(productId).toArray())
        : 0,
    [productId],
  );
}

/** "12.5 kg", "0 kg", "−2 kg" (qtyLabel is for positive amounts, so the sign is added here). */
export function useStockText() {
  const { t } = useTranslation();
  const qtyText = useQtyText();
  return (qtyMilli: number, unit: UnitCode) => {
    if (qtyMilli === 0) return t('sale.qty', { amount: '0', unit: unitName(t, unit) });
    const text = qtyText(Math.abs(qtyMilli), unit);
    return qtyMilli < 0 ? `−${text}` : text;
  };
}
