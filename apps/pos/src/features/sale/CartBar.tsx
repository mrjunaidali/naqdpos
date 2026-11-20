import { useTranslation } from 'react-i18next';
import { useCartTotals } from './cartStore.ts';
import { useRs } from './saleFormat.ts';

/**
 * Cart bar fixed at the bottom (docs/design-theme.md, Sale): item count, total, Charge. Payment
 * is the next story, so Charge is disabled for now.
 */
export function CartBar({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const totals = useCartTotals();
  const rs = useRs();
  if (totals.itemCount === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 p-3">
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl bg-primary p-2 text-primary-fg">
        <button
          type="button"
          onClick={onOpen}
          className="min-h-12 flex-1 rounded-xl px-3 text-start"
          aria-label={t('sale.openCart', { count: totals.itemCount })}
        >
          <span className="block text-sm">{t('sale.items', { count: totals.itemCount })}</span>
          <span className="block text-xl font-bold" dir="ltr">
            {rs(totals.total_paisa)}
          </span>
        </button>
        <div className="text-end">
          <button
            type="button"
            disabled
            aria-describedby="charge-note"
            className="min-h-12 rounded-xl bg-surface px-5 font-semibold text-text opacity-60"
          >
            {t('sale.charge')}
          </button>
          <span id="charge-note" className="block text-xs">
            {t('sale.paymentNext')}
          </span>
        </div>
      </div>
    </div>
  );
}
