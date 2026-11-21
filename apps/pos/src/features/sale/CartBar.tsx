import { useTranslation } from 'react-i18next';
import { useCartTotals } from './cartStore.ts';
import { useRs } from './saleFormat.ts';

/**
 * Cart bar fixed at the bottom (docs/design-theme.md, Sale): item count, total, Charge (opens the
 * pay screen, after the owner's PIN when a cashier is over the discount limit; F2 on a keyboard).
 */
export function CartBar({ onOpen, onCharge }: { onOpen: () => void; onCharge: () => void }) {
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
        <button
          type="button"
          onClick={onCharge}
          className="min-h-12 rounded-xl bg-surface px-6 text-lg font-bold text-text"
        >
          {t('sale.charge')}
        </button>
      </div>
    </div>
  );
}
