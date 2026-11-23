import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { StaffChip } from '../features/pin/StaffChip.tsx';
import { otherLanguage } from '../i18n/index.ts';
import { SyncChip } from '../sync/SyncChip.tsx';
import { UpdateRequiredBanner } from '../sync/UpdateRequiredBanner.tsx';
import { BrandMark } from '../ui/BrandMark.tsx';
import { Toaster } from '../ui/Toaster.tsx';
import { Nav } from '../features/home/Nav.tsx';
import { SuspendedBanner } from './SuspendedBanner.tsx';
import { useAppState } from './appState.ts';
import { useSessionCheck } from './sessionCheck.ts';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

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
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <Link
          to="/"
          aria-label={t('nav.home')}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-text"
        >
          <BrandMark logoPath={shop?.logoPath ?? null} />
          <span className="min-w-0 truncate text-lg font-semibold">
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
              <GearIcon />
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
      </header>
      {ready && <SuspendedBanner />}
      {ready && <UpdateRequiredBanner />}
      <div className="flex flex-1">
        {ready && <Nav />}
        <main className="min-w-0 flex-1 p-4">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
