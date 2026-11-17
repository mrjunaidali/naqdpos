import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * "New version available — Reload" banner (architecture §6). Never auto-reloads.
 * TODO(sale story): hide while the cart has items.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-gray-900 px-4 py-2 text-white"
    >
      <span>{t('pwa.updateAvailable')}</span>
      <div className="flex gap-2">
        <button
          type="button"
          className="min-h-11 rounded-md px-3"
          onClick={() => setNeedRefresh(false)}
        >
          {t('pwa.later')}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-md bg-green-600 px-3 font-semibold"
          onClick={() => void updateServiceWorker()}
        >
          {t('pwa.reload')}
        </button>
      </div>
    </div>
  );
}
