import { useTranslation } from 'react-i18next';
import { useCartIsEmpty } from '../features/sale/cartStore.ts';
import { useUpdateRequired } from '../sync/useUpdateRequired.ts';

interface Props {
  visible: boolean;
  onLater: () => void;
  onReload: () => void;
}

/**
 * "New version available — Reload" (architecture §6). Never while the cart has items, and not
 * while the persistent "Update required to sync" banner already offers the reload.
 */
export function NewVersionBanner({ visible, onLater, onReload }: Props) {
  const { t } = useTranslation();
  const cartEmpty = useCartIsEmpty();
  const updateRequired = useUpdateRequired();
  if (!visible || !cartEmpty || updateRequired) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-primary px-4 py-2 text-primary-fg"
    >
      <span>{t('pwa.updateAvailable')}</span>
      <div className="flex gap-2">
        <button type="button" className="min-h-11 rounded-md px-3" onClick={onLater}>
          {t('pwa.later')}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-md bg-surface px-3 font-semibold text-text"
          onClick={onReload}
        >
          {t('pwa.reload')}
        </button>
      </div>
    </div>
  );
}
