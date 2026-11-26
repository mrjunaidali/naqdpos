import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { StaffChip } from '../features/pin/StaffChip.tsx';
import { otherLanguage } from '../i18n/index.ts';
import { SyncChip } from '../sync/SyncChip.tsx';
import { UpdateRequiredBanner } from '../sync/UpdateRequiredBanner.tsx';
import { BrandMark } from '../ui/BrandMark.tsx';
import { Icon } from '../ui/icons.tsx';
import { Toaster } from '../ui/Toaster.tsx';
import { Nav } from '../features/home/Nav.tsx';
import { SuspendedBanner } from './SuspendedBanner.tsx';
import { useAppState } from './appState.ts';
import { useSessionCheck } from './sessionCheck.ts';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';

export function RootLayout() {
  const { t, i18n } = useTranslation();
  useSessionCheck();
  const ready = useAppState() === 'ready';
  const { pathname } = useLocation();
  const shop = useLiveQuery(async () => {
    const device = await getStoredDevice();
    const row = device ? await db.shops.get(device.shop_id) : undefined;
    return row ? { name: row.name, logoPath: row.logo_path } : null;
  });

  return (
    <div className="flex min-h-dvh flex-col pt-header">
      {/* Fixed so it stays while the page scrolls; its surface runs up behind the status bar. */}
      <header className="fixed inset-x-0 top-0 z-20 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="flex h-[calc(var(--header-h)-1px)] items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
          <Link
            to="/"
            aria-label={t('nav.home')}
            // min-w: the shop name keeps a few letters and an ellipsis at 375px; the chips beside
            // it shrink instead (bug 2026-11-25: it collapsed to one letter next to the mark).
            className="flex min-h-11 min-w-28 flex-1 items-center gap-2 rounded-md text-text"
          >
            <BrandMark logoPath={shop?.logoPath ?? null} />
            {/* dir=auto: a Latin shop name in Urdu (RTL) still cuts at its own end. */}
            <span dir="auto" className="min-w-0 truncate text-base font-semibold sm:text-lg">
              {shop?.name ?? t('app.name')}
            </span>
          </Link>
          {ready ? (
            <>
              <StaffChip />
              {/* Home shows it in the hero card. */}
              {pathname !== '/' && <SyncChip />}
              <Link
                to="/settings"
                aria-label={t('settings.title')}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-text"
              >
                <Icon name="settings" />
              </Link>
            </>
          ) : (
            <button
              type="button"
              className="min-h-11 min-w-11 rounded-md px-3 text-text"
              aria-label={t('language.switchLabel')}
              onClick={() => void i18n.changeLanguage(otherLanguage(i18n.language))}
            >
              {t('language.other')}
            </button>
          )}
        </div>
      </header>
      {ready && <SuspendedBanner />}
      {ready && <UpdateRequiredBanner />}
      <div className="flex flex-1">
        {ready && <Nav />}
        <main className="min-w-0 flex-1 px-4 pt-4 pb-nav">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
