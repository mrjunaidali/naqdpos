import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';
import { AFTER_SETUP_KEY } from '../features/onboarding/setup.ts';

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const info = useLiveQuery(async () => {
    const device = await getStoredDevice();
    const shop = device ? await db.shops.get(device.shop_id) : undefined;
    return { shopName: shop?.name, code: device?.code };
  });

  // Right after setup: open the next step once (e.g. the produce picker for fruit & veg shops).
  useEffect(() => {
    void db.meta.get(AFTER_SETUP_KEY).then(async (entry) => {
      if (typeof entry?.value !== 'string') return;
      await db.meta.delete(AFTER_SETUP_KEY);
      void navigate(entry.value, { replace: true });
    });
  }, [navigate]);

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">{t('home.welcome')}</h1>
      {info?.shopName && <p className="text-lg">{info.shopName}</p>}
      {info?.code && <p className="text-muted">{t('home.deviceCode', { code: info.code })}</p>}
      <p className="text-muted">{t('app.tagline')}</p>
      <Link
        to="/sale"
        className="mt-4 flex min-h-16 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-fg"
      >
        {t('home.newSale')}
      </Link>
      <Link
        to="/sales"
        className="flex min-h-12 items-center justify-center rounded-2xl border border-border bg-surface font-semibold text-text"
      >
        {t('home.todaysSales')}
      </Link>
      <Link
        to="/khata"
        className="flex min-h-12 items-center justify-center rounded-2xl border border-border bg-surface font-semibold text-text"
      >
        {t('home.khata')}
      </Link>
    </section>
  );
}
