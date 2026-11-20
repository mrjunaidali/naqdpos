import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';

export function HomePage() {
  const { t } = useTranslation();
  const info = useLiveQuery(async () => {
    const device = await getStoredDevice();
    const shop = device ? await db.shops.get(device.shop_id) : undefined;
    return { shopName: shop?.name, code: device?.code };
  });

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">{t('home.welcome')}</h1>
      {info?.shopName && <p className="text-lg">{info.shopName}</p>}
      {info?.code && <p className="text-muted">{t('home.deviceCode', { code: info.code })}</p>}
      <p className="text-muted">{t('app.tagline')}</p>
    </section>
  );
}
