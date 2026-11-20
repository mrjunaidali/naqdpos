import { displayName, type CartLine } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { ProductIcon } from '../catalogue/ProductIcon.tsx';
import { useCartStore, useCartTotals } from './cartStore.ts';
import { useQtyText, useRs } from './saleFormat.ts';

/** The cart (US029): lines, edit (tap), remove, and "Clear cart" with a confirm step. */
export function CartSheet(props: { onEdit: (line: CartLine) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const remove = useCartStore((s) => s.remove);
  const clear = useCartStore((s) => s.clear);
  const totals = useCartTotals();
  const rs = useRs();
  const qtyText = useQtyText();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <Sheet title={t('sale.cartTitle')} onClose={props.onClose}>
      {lines.length === 0 ? (
        <p className="text-muted">{t('sale.cartEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center gap-2 py-2">
              <span className="w-10 shrink-0 text-center">
                <ProductIcon icon={line.icon} />
              </span>
              <button
                type="button"
                className="min-h-11 min-w-0 flex-1 text-start"
                onClick={() => props.onEdit(line)}
                aria-label={t('sale.editLine', { name: line.name })}
              >
                <span className="block truncate font-medium">
                  {displayName(line, i18n.language)}
                  {line.is_custom && (
                    <span className="ms-2 rounded-full bg-bg px-2 text-xs text-muted">
                      {t('sale.custom')}
                    </span>
                  )}
                </span>
                <span className="block text-sm text-muted">
                  {line.by_amount
                    ? t('sale.lineByAmount', { qty: qtyText(line.qty_milli, line.unit) })
                    : t('sale.lineQty', {
                        qty: qtyText(line.qty_milli, line.unit),
                        rate: rs(line.unit_price_paisa),
                      })}
                </span>
              </button>
              <span className="font-semibold" dir="ltr">
                {rs(line.line_total_paisa)}
              </span>
              <button
                type="button"
                onClick={() => remove(line.id)}
                aria-label={t('sale.removeLine', { name: line.name })}
                className="min-h-11 min-w-11 rounded-md border border-border"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="flex justify-between text-lg font-semibold">
        <span>{t('sale.total')}</span>
        <span dir="ltr">{rs(totals.total_paisa)}</span>
      </p>
      {lines.length > 0 &&
        (confirmClear ? (
          <div className="space-y-2 rounded-xl border border-danger p-3">
            <p className="font-medium">{t('sale.clearConfirm')}</p>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  clear();
                  setConfirmClear(false);
                  props.onClose();
                }}
              >
                {t('sale.clearYes')}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmClear(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmClear(true)}>
            {t('sale.clearCart')}
          </Button>
        ))}
    </Sheet>
  );
}
