import { businessDate, sumPaisa } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { SaleDetail } from './SaleDetail.tsx';
import { useSaleBundle } from './saleData.ts';
import { intlLocale } from '../../i18n/format.ts';
import { useRs } from './saleFormat.ts';
import { useViewer, visibleTo } from './saleVisibility.ts';

/** Today's sales (Home → "Today's sales"), from Dexie. */
export function SalesListPage() {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const viewer = useViewer();
  const today = businessDate();
  const sales = useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    const rows = await db.sales.where('business_date').equals(today).toArray();
    return rows
      .filter((s) => s.shop_id === device.shop_id)
      .sort((a, b) => b.id.localeCompare(a.id));
  }, [today]);
  if (!sales || !viewer.ready) return null;
  const mine = sales.filter((s) => visibleTo(s, viewer.staffId, viewer.isOwner));
  const time = new Intl.DateTimeFormat(intlLocale(i18n.language), { timeStyle: 'short' });

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('sales.title')}</h1>
      <p className="text-muted">{viewer.isOwner ? t('sales.allToday') : t('sales.yoursToday')}</p>
      <div className="rounded-2xl bg-hero p-4 text-hero-fg">
        <p className="text-sm text-hero-muted">{t('sales.count', { count: mine.length })}</p>
        <p className="text-3xl font-bold" dir="ltr">
          {rs(sumPaisa(mine.map((s) => s.total_paisa)))}
        </p>
      </div>
      {mine.length === 0 ? (
        <p className="text-muted">{t('sales.none')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {mine.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sales/${s.id}`}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-2"
              >
                <span>
                  <span className="block font-medium" dir="ltr">
                    {s.receipt_no}
                  </span>
                  <span className="block text-sm text-muted">
                    {time.format(new Date(s.created_at))}
                  </span>
                </span>
                <span className="font-semibold" dir="ltr">
                  {rs(s.total_paisa)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One sale (from the list). A cashier cannot open someone else's sale. */
export function SaleViewPage() {
  const { t } = useTranslation();
  const { saleId } = useParams();
  const bundle = useSaleBundle(saleId);
  const viewer = useViewer();
  if (bundle === undefined || !viewer.ready) return null;
  if (bundle === null || !visibleTo(bundle.sale, viewer.staffId, viewer.isOwner)) {
    return <p className="text-muted">{t('sales.notFound')}</p>;
  }
  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold" dir="ltr">
        {bundle.sale.receipt_no}
      </h1>
      <SaleDetail bundle={bundle} />
      <Link
        to={`/receipt/${bundle.sale.id}`}
        className="flex min-h-12 items-center justify-center rounded-md border border-border bg-surface font-semibold text-text"
      >
        {t('done.receipt')}
      </Link>
      <Link to="/sales" className="inline-flex min-h-11 items-center text-text underline">
        {t('sales.back')}
      </Link>
    </section>
  );
}
