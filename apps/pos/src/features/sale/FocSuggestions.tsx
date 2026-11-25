import { displayName, focSuggestions, makeLine, type ProductRow } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';
import { useCartStore } from './cartStore.ts';
import { useQtyText } from './saleFormat.ts';

/**
 * "Add free Coriander (1 bundle)?" (US033): one tap adds the product as a free line. Shown when
 * the bill reaches the product's minimum and it is not in the cart; never added automatically.
 */
export function FocSuggestions({
  products,
  inline = false,
}: {
  products: readonly ProductRow[];
  /** Wide screens: in the products pane, not floating over the cart panel. */
  inline?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const put = useCartStore((s) => s.put);
  const qtyText = useQtyText();
  const suggestions = focSuggestions(lines, products);
  if (suggestions.length === 0) return null;
  return (
    <div
      className={
        inline ? '' : 'fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 px-3'
      }
    >
      <div className={`flex flex-wrap gap-2 ${inline ? '' : 'mx-auto max-w-3xl justify-center'}`}>
        {suggestions.map(({ product, qty_milli }) => (
          <button
            key={product.id}
            type="button"
            onClick={() => {
              const line = makeLine(
                {
                  product_id: product.id,
                  name: product.name,
                  name_ur: product.name_ur,
                  unit: product.unit,
                  icon: product.icon ?? null,
                  unit_price_paisa: product.sale_price_paisa,
                },
                qty_milli,
              );
              if (!('error' in line)) put({ ...line, is_foc: true });
            }}
            className="min-h-11 rounded-full border-2 border-dashed border-success bg-success-soft px-4 text-sm font-semibold text-success-fg shadow"
          >
            {t('foc.suggest', {
              name: displayName(product, i18n.language),
              qty: qtyText(qty_milli, product.unit),
            })}
          </button>
        ))}
      </div>
    </div>
  );
}
