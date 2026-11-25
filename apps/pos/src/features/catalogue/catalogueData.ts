// Live catalogue reads for the screens (Dexie only; the UI never asks the server).
import {
  getPresetsForShopType,
  paisaToRupeesString,
  rupeesText,
  type CategoryRow,
  type Paisa,
  type PresetList,
  type ProductRow,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { shopCategories } from './catalogueRepo.ts';

/** All products of this shop, hidden ones included (screens filter). */
export function useShopProducts(): ProductRow[] | undefined {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    return db.products.where('shop_id').equals(device.shop_id).toArray();
  });
}

/**
 * The ready-made list for this shop's type (fruit & veg today), null when the type has none,
 * undefined while loading. Live from Dexie, so a type change in Settings applies at once.
 */
export function useShopPresets(): PresetList | null | undefined {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    const shop = device ? await db.shops.get(device.shop_id) : undefined;
    return { list: shop ? getPresetsForShopType(shop.type) : null };
  })?.list;
}

export function useCategories(): CategoryRow[] | undefined {
  return useLiveQuery(shopCategories);
}

/** Costs are shown only where they live: owner devices (decision 4, Step 7). */
export function useCostsHere(): boolean | undefined {
  return useLiveQuery(async () => (await getStoredDevice())?.mode === 'owner');
}

/** Current costs by product id (empty on shop devices: they never hold costs). */
export function useCosts(): Map<string, Paisa> | undefined {
  return useLiveQuery(async () => {
    const rows = await db.product_costs.toArray();
    return new Map(
      rows.filter((r) => r.deleted_at === null).map((r) => [r.product_id, r.cost_price_paisa]),
    );
  });
}

/** Paisa → what goes in a rupee input: 8000 → "80", 6250 → "62.50". */
export function rupeesInput(paisa: Paisa | null | undefined): string {
  if (paisa === null || paisa === undefined) return '';
  return paisaToRupeesString(paisa).replace(/\.00$/, '');
}

/** "Rs 160/kg" in the UI language. */
export function usePriceLabel() {
  const { t } = useTranslation();
  return (product: Pick<ProductRow, 'sale_price_paisa' | 'unit'>) =>
    product.sale_price_paisa === 0
      ? t('products.noRate')
      : t('products.pricePerUnit', {
          amount: rupeesText(product.sale_price_paisa),
          unit: t(`unit.${product.unit}`),
        });
}
