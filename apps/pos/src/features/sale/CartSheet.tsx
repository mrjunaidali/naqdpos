import { computeBill, displayName, lineDiscountPaisa, lineNet, type CartLine } from '@naqdpos/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { ProductIcon } from '../catalogue/ProductIcon.tsx';
import { useCartStore } from './cartStore.ts';
import { DiscountSheet } from './DiscountSheet.tsx';
import { useQtyText, useRs } from './saleFormat.ts';

/**
 * The cart (US029): lines, edit (tap), remove, "Clear cart" with a confirm step; per line a
 * discount (Rs or %) and "Free" (FOC, US032 / US033). Totals update live.
 */
export function CartSheet(props: {
  onEdit: (line: CartLine) => void;
  onClose: () => void;
  /** A side panel on wide screens instead of a sheet. */
  inline?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const remove = useCartStore((s) => s.remove);
  const put = useCartStore((s) => s.put);
  const [discountFor, setDiscountFor] = useState<CartLine | null>(null);
  const clear = useCartStore((s) => s.clear);
  const bill = computeBill(lines);
  const rs = useRs();
  const qtyText = useQtyText();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <Wrap inline={props.inline ?? false} title={t('sale.cartTitle')} onClose={props.onClose}>
      {lines.length === 0 ? (
        <p className="text-muted">{t('sale.cartEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <li
              key={line.id}
              data-foc={line.is_foc || undefined}
              className={`space-y-1 py-2 ${
                line.is_foc ? 'my-1 rounded-xl border-2 border-dashed border-success px-2' : ''
              }`}
            >
              <div className="flex items-center gap-2">
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
                <span className="text-end">
                  {line.is_foc ? (
                    <>
                      <span className="block text-sm font-bold text-success">{t('foc.label')}</span>
                      <span className="block text-xs text-muted">
                        {t('foc.value', { amount: rs(line.line_total_paisa) })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block font-semibold" dir="ltr">
                        {rs(lineNet(line))}
                      </span>
                      {lineDiscountPaisa(line) > 0 && (
                        <span className="block text-xs text-muted line-through" dir="ltr">
                          {rs(line.line_total_paisa)}
                        </span>
                      )}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => remove(line.id)}
                  aria-label={t('sale.removeLine', { name: line.name })}
                  className="min-h-11 min-w-11 rounded-md border border-border"
                >
                  ✕
                </button>
              </div>
              {lineDiscountPaisa(line) > 0 && (
                <p className="flex justify-between ps-12 text-sm text-muted">
                  <span>
                    {line.discount?.kind === 'pct'
                      ? t('discount.linePct', { pct: line.discount.value })
                      : t('discount.line')}
                  </span>
                  <span dir="ltr">−{rs(lineDiscountPaisa(line))}</span>
                </p>
              )}
              <div className="flex gap-2 ps-12">
                <button
                  type="button"
                  disabled={line.is_foc}
                  onClick={() => setDiscountFor(line)}
                  aria-label={t('discount.forLine', { name: line.name })}
                  className="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50"
                >
                  {t('discount.button')}
                </button>
                <button
                  type="button"
                  aria-pressed={line.is_foc}
                  onClick={() => put({ ...line, is_foc: !line.is_foc, discount: null })}
                  aria-label={t('foc.toggleFor', { name: line.name })}
                  className={`min-h-11 rounded-md border px-3 text-sm ${
                    line.is_foc
                      ? 'border-success bg-success-soft font-semibold text-success-fg'
                      : 'border-border'
                  }`}
                >
                  {t('foc.toggle')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {bill.line_discount_paisa > 0 && (
        <p className="flex justify-between text-sm text-muted">
          <span>{t('discount.lines')}</span>
          <span dir="ltr">−{rs(bill.line_discount_paisa)}</span>
        </p>
      )}
      {bill.foc_value_paisa > 0 && (
        <p className="flex justify-between text-sm text-muted">
          <span>{t('foc.total')}</span>
          <span dir="ltr">{rs(bill.foc_value_paisa)}</span>
        </p>
      )}
      <p className="flex justify-between text-lg font-semibold">
        <span>{t('sale.total')}</span>
        <span dir="ltr">{rs(bill.subtotal_paisa)}</span>
      </p>
      {discountFor && (
        <DiscountSheet
          title={t('discount.lineTitle', { name: displayName(discountFor, i18n.language) })}
          basePaisa={discountFor.line_total_paisa}
          initial={discountFor.discount}
          onApply={(discount) => {
            put({ ...discountFor, discount });
            setDiscountFor(null);
          }}
          onRemove={() => {
            put({ ...discountFor, discount: null });
            setDiscountFor(null);
          }}
          onClose={() => setDiscountFor(null)}
        />
      )}
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
    </Wrap>
  );
}

function Wrap(props: { inline: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!props.inline)
    return (
      <Sheet title={props.title} onClose={props.onClose}>
        {props.children}
      </Sheet>
    );
  return (
    <section
      aria-label={props.title}
      className="space-y-4 rounded-2xl border border-border bg-surface p-4"
    >
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}
