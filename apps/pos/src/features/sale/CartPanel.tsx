import { computeBill, displayName, lineDiscountPaisa, lineNet, type CartLine } from '@naqdpos/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomerChip } from '../khata/CustomerChip.tsx';
import { useCartStore } from './cartStore.ts';
import { DiscountSheet } from './DiscountSheet.tsx';
import { stepLine } from './qtyStep.ts';
import { unitName, useQtyText, useRs } from './saleFormat.ts';

/**
 * The cart beside the product grid on wide screens (≥768px). Always shown (an empty state when
 * nothing is in it) so the layout never jumps. Header and footer stay put; only the lines scroll.
 * Each line is one row: name + rate (tap to edit), − qty +, total, and a ⋮ menu with Discount,
 * Free (FOC) and Remove. Phones keep the cart bar and CartSheet.
 */
export function CartPanel(props: {
  onEdit: (line: CartLine) => void;
  onCharge: () => void;
  canSell: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const put = useCartStore((s) => s.put);
  const clear = useCartStore((s) => s.clear);
  const bill = computeBill(lines);
  const rs = useRs();
  const [discountFor, setDiscountFor] = useState<CartLine | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const empty = lines.length === 0;

  return (
    <section
      aria-label={t('sale.cartTitle')}
      className="sticky top-[calc(var(--top-inset)+1rem)] flex h-[calc(100dvh-var(--top-inset)-var(--bottom-inset)-2rem)] min-h-[24rem] flex-col rounded-2xl border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h2 className="text-lg font-semibold">{t('sale.cartTitle')}</h2>
        <span className="flex-1 text-sm text-muted">
          {t('sale.items', { count: lines.length })}
        </span>
        <CustomerChip disabled={!props.canSell} />
      </header>

      {empty ? (
        <p className="flex flex-1 items-center justify-center p-6 text-center text-muted">
          {t('sale.cartEmptyHint')}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-3">
          {lines.map((line) => (
            <PanelLine
              key={line.id}
              line={line}
              onEdit={() => props.onEdit(line)}
              onDiscount={() => setDiscountFor(line)}
            />
          ))}
        </ul>
      )}

      <footer className="space-y-2 border-t border-border p-3">
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
        <p className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">{t('sale.total')}</span>
          <span className="text-3xl font-bold" dir="ltr">
            {rs(bill.subtotal_paisa)}
          </span>
        </p>
        <button
          type="button"
          disabled={empty}
          onClick={props.onCharge}
          className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-primary px-4 text-lg font-bold text-primary-fg disabled:opacity-40"
        >
          <span>{t('sale.chargeTotal', { amount: rs(bill.subtotal_paisa) })}</span>
          <kbd
            aria-hidden="true"
            className="rounded border border-primary-fg/40 px-1.5 text-xs font-medium"
          >
            F2
          </kbd>
        </button>
        {!empty &&
          (confirmClear ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 font-medium">{t('sale.clearConfirm')}</span>
              <button
                type="button"
                onClick={() => {
                  clear();
                  setConfirmClear(false);
                }}
                className="min-h-11 rounded-md bg-danger px-3 font-semibold text-surface"
              >
                {t('sale.clearYes')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-11 rounded-md px-3 text-muted"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="mx-auto block min-h-11 px-3 text-sm text-muted underline"
            >
              {t('sale.clearCart')}
            </button>
          ))}
      </footer>

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
    </section>
  );
}

/**
 * One line, one row from 1280px (xl, 28rem panel); below that the stepper and ⋮ drop under the
 * name so the name stays readable.
 */
function PanelLine(props: { line: CartLine; onEdit: () => void; onDiscount: () => void }) {
  const { t, i18n } = useTranslation();
  const { line } = props;
  const put = useCartStore((s) => s.put);
  const rs = useRs();
  const qtyText = useQtyText();
  const name = displayName(line, i18n.language);
  const down = stepLine(line, -1);
  const up = stepLine(line, 1);
  const stepClass =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border text-lg font-semibold disabled:opacity-40';

  return (
    <li
      data-foc={line.is_foc || undefined}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 py-2 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto] ${
        line.is_foc ? 'my-1 rounded-xl border-2 border-dashed border-success px-2' : ''
      }`}
    >
      <button
        type="button"
        onClick={props.onEdit}
        aria-label={t('sale.editLine', { name })}
        title={name}
        className="min-h-11 min-w-0 text-start"
      >
        <span className="block truncate font-medium">
          {name}
          {line.is_custom && (
            <span className="ms-2 rounded-full bg-bg px-2 text-xs text-muted">
              {t('sale.custom')}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted" dir="ltr">
          {line.by_amount
            ? t('sale.lineByAmount', { qty: qtyText(line.qty_milli, line.unit) })
            : t('sale.lineRate', {
                rate: rs(line.unit_price_paisa),
                unit: unitName(t, line.unit),
              })}
        </span>
      </button>

      <span className="text-end xl:order-3">
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

      <span className="flex items-center gap-1 xl:order-2" dir="ltr">
        <button
          type="button"
          disabled={!down}
          onClick={() => down && put(down)}
          aria-label={t('sale.less', { name })}
          className={stepClass}
        >
          −
        </button>
        <span className="min-w-14 text-center text-sm font-semibold" aria-live="polite">
          {qtyText(line.qty_milli, line.unit)}
        </span>
        <button
          type="button"
          disabled={!up}
          onClick={() => up && put(up)}
          aria-label={t('sale.more', { name })}
          className={stepClass}
        >
          +
        </button>
      </span>

      <LineMenu line={line} name={name} onDiscount={props.onDiscount} />
    </li>
  );
}

/** ⋮ : Discount, Free (FOC), Remove — same labels as the phone cart's buttons. */
function LineMenu(props: { line: CartLine; name: string; onDiscount: () => void }) {
  const { t } = useTranslation();
  const { line, name } = props;
  const put = useCartStore((s) => s.put);
  const remove = useCartStore((s) => s.remove);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // Closes on a tap outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'block min-h-11 w-full px-4 text-start hover:bg-bg disabled:opacity-50';
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <span ref={box} className="relative justify-self-end xl:order-4">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('sale.lineMenu', { name })}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl"
      >
        ⋮
      </button>
      {open && (
        <span
          role="menu"
          className="absolute end-0 top-full z-10 mt-1 block w-44 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={line.is_foc}
            onClick={act(props.onDiscount)}
            aria-label={t('discount.forLine', { name })}
            className={item}
          >
            {t('discount.button')}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={line.is_foc}
            onClick={act(() => put({ ...line, is_foc: !line.is_foc, discount: null }))}
            aria-label={t('foc.toggleFor', { name })}
            className={item}
          >
            {line.is_foc ? '✓ ' : ''}
            {t('foc.toggle')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={act(() => remove(line.id))}
            aria-label={t('sale.removeLine', { name })}
            className={`${item} text-danger`}
          >
            {t('sale.remove')}
          </button>
        </span>
      )}
    </span>
  );
}
