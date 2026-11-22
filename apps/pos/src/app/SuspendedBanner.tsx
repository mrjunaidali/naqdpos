import { useTranslation } from 'react-i18next';
import { useShopSuspended } from './suspension.ts';

/** Persistent while the shop is suspended (US011). */
export function SuspendedBanner() {
  const { t } = useTranslation();
  if (!useShopSuspended()) return null;
  return (
    <p role="alert" className="bg-danger px-4 py-2 text-center font-semibold text-surface">
      {t('app.suspended')}
    </p>
  );
}
