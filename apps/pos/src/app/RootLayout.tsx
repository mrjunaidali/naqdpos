import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';
import { otherLanguage } from '../i18n/index.ts';
import { SyncChip } from '../sync/SyncChip.tsx';
import { UpdateRequiredBanner } from '../sync/UpdateRequiredBanner.tsx';
import { BrandMark } from '../ui/BrandMark.tsx';
import { useSessionCheck } from './sessionCheck.ts';

export function RootLayout() {
  const { t, i18n } = useTranslation();
  useSessionCheck();
  // The sync chip only makes sense once this device is registered to a shop.
  const shop = useLiveQuery(async () => {
    const device = await getStoredDevice();
    return device ? ((await db.shops.get(device.shop_id)) ?? null) : null;
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <BrandMark />
        <span className="min-w-0 flex-1 truncate text-lg font-semibold">
          {shop?.name ?? t('app.name')}
        </span>
        {shop && <SyncChip />}
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-md px-3 text-text"
          aria-label={t('language.switchLabel')}
          onClick={() => void i18n.changeLanguage(otherLanguage(i18n.language))}
        >
          {t('language.other')}
        </button>
      </header>
      {shop && <UpdateRequiredBanner />}
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
