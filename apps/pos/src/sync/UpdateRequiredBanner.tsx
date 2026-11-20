// Persistent banner while the API refuses this app version (426, architecture §4). Only sync is
// paused; selling goes on. Reload is offered only with an empty cart (§6, §7).
import { useTranslation } from 'react-i18next';
import { reloadApp } from '../app/swUpdate.ts';
import { useCartIsEmpty } from '../features/sale/cartStore.ts';
import { useUpdateRequired } from './useUpdateRequired.ts';

export function UpdateRequiredBanner() {
  const { t } = useTranslation();
  const required = useUpdateRequired();
  const cartEmpty = useCartIsEmpty();
  if (!required) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-warning bg-warning-soft px-4 py-2 text-warning-fg"
    >
      <span className="font-medium">{t('sync.updateRequired')}</span>
      {cartEmpty ? (
        <button
          type="button"
          className="min-h-11 rounded-md bg-primary px-4 font-semibold text-primary-fg"
          onClick={() => void reloadApp()}
        >
          {t('sync.reload')}
        </button>
      ) : (
        <span className="text-sm">{t('sync.finishSaleToReload')}</span>
      )}
    </div>
  );
}
