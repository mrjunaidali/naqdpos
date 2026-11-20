import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { useOnline } from '../../app/useOnline.ts';
import { db } from '../../db/schema.ts';
import { useSyncStatus } from '../../sync/useSyncStatus.ts';
import { showToast } from '../../ui/toastStore.ts';
import { SaleDetail } from './SaleDetail.tsx';
import { useSaleBundle } from './saleData.ts';

export const REMINDER_KEY = 'sync_reminder_shown_at';
const REMINDER_EVERY_MS = 30 * 60 * 1000;

/**
 * After the sale (US034): receipt number, items, total, how it was paid, change. The §7 reminder
 * toast is checked here, never during cart entry, at most once per 30 minutes.
 */
export function SaleDonePage() {
  const { t } = useTranslation();
  const { saleId } = useParams();
  const location = useLocation();
  const change = (location.state as { change?: number } | null)?.change;
  const bundle = useSaleBundle(saleId);
  const online = useOnline();
  const { health, outboxCount } = useSyncStatus();
  const remind = health.level === 'reminder';

  useEffect(() => {
    if (!remind) return;
    void db.meta.get(REMINDER_KEY).then(async (entry) => {
      const last = typeof entry?.value === 'number' ? entry.value : 0;
      if (Date.now() - last < REMINDER_EVERY_MS) return;
      await db.meta.put({ key: REMINDER_KEY, value: Date.now() });
      showToast(t('sync.reminderToast', { count: outboxCount }), 8000);
    });
  }, [remind, outboxCount, t]);

  if (bundle === undefined) return null;
  if (bundle === null) return <p className="text-muted">{t('sales.notFound')}</p>;

  return (
    <section className="mx-auto max-w-md space-y-4">
      <div className="rounded-2xl bg-hero p-4 text-hero-fg">
        <p className="text-sm text-hero-muted">{t('done.title')}</p>
        <p className="text-2xl font-bold" dir="ltr">
          {bundle.sale.receipt_no}
        </p>
      </div>
      {!online && <p className="text-muted">{t('done.savedOffline')}</p>}
      <SaleDetail bundle={bundle} {...(change !== undefined ? { change } : {})} />
      <Link
        to="/sale"
        replace
        className="flex min-h-14 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-fg"
      >
        {t('done.newSale')}
      </Link>
      <button
        type="button"
        disabled
        title={t('done.receiptLater')}
        className="min-h-12 w-full rounded-md border border-border bg-surface font-semibold text-text opacity-60"
      >
        {t('done.receipt')}
      </button>
    </section>
  );
}
