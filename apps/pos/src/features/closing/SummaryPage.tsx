import { dailySummary, receiptText, type DaySummary } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { printReceipt } from '../../print/printReceipt.ts';
import { ReceiptView } from '../../print/ReceiptView.tsx';
import { shareReceipt } from '../../print/share.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { showToast } from '../../ui/toastStore.ts';
import { categoryName } from '../expenses/expenseRepo.ts';
import { useRs } from '../sale/saleFormat.ts';
import { methodName } from '../settings/paymentMethods.ts';
import { costsAt, dayRows, useDayCloses } from './closingData.ts';

/** Daily summary (US045): after closing and from past closes; WhatsApp and print. */
export function SummaryPage() {
  const { businessDate } = useParams();
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const summary = useLiveQuery(async (): Promise<DaySummary | null> => {
    const device = await getStoredDevice();
    if (!device || !businessDate) return null;
    const close = (await db.day_closes.where('business_date').equals(businessDate).toArray()).find(
      (c) => c.shop_id === device.shop_id,
    );
    if (!close) return null;
    const [rows, shop, products, categories, methods, costs] = await Promise.all([
      dayRows(businessDate),
      db.shops.get(device.shop_id),
      db.products.toArray(),
      db.expense_categories.toArray(),
      db.payment_methods.toArray(),
      costsAt(businessDate),
    ]);
    return dailySummary({
      close,
      ...rows,
      products: new Map(products.map((p) => [p.id, { name: p.name, unit: p.unit }])),
      costs,
      categoryName: (id) => {
        const c = categories.find((x) => x.id === id);
        return c ? categoryName(c, t, i18n.language) : '—';
      },
      methodName: (code) =>
        methodName(methods.find((m) => m.code === code) ?? { code, label: code }, t),
      label: (key, vars) => t(key, vars ?? {}),
      shopName: shop?.name ?? '',
      paperWidthMm: shop?.paper_width_mm ?? 58,
      rtl: i18n.language === 'ur',
    });
  }, [businessDate, i18n.language]);

  if (summary === undefined) return null;
  if (summary === null) return <p className="text-muted">{t('closing.notFound')}</p>;

  async function share() {
    const outcome = await shareReceipt(receiptText(summary!.doc), null);
    if (outcome === 'copied') showToast(t('receipt.copied'));
  }

  return (
    <section className="mx-auto max-w-md space-y-4 pb-8">
      <h1 className="text-2xl font-bold">{t('closing.summaryTitle', { date: businessDate })}</h1>
      {summary.gapPaisa !== 0 && (
        <Alert>{t('closing.gapAlert', { amount: rs(summary.gapPaisa) })}</Alert>
      )}
      <div className="receipt-print overflow-x-auto rounded-2xl border border-border bg-surface p-3">
        <ReceiptView doc={summary.doc} />
      </div>
      <Button onClick={() => void share()}>{t('receipt.shareWhatsapp')}</Button>
      <Button variant="secondary" onClick={() => printReceipt(summary.doc)}>
        {t('receipt.print')}
      </Button>
      <Link to="/closing/history" className="inline-flex min-h-11 items-center underline">
        {t('closing.history')}
      </Link>
    </section>
  );
}

/** Past closes, newest first. */
export function CloseHistoryPage() {
  const { t } = useTranslation();
  const rs = useRs();
  const closes = useDayCloses();
  if (!closes) return null;
  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{t('closing.history')}</h1>
      {closes.length === 0 ? (
        <p className="text-muted">{t('closing.noCloses')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {closes.map((c) => (
            <li key={c.id}>
              <Link
                to={`/closing/${c.business_date}`}
                className="flex min-h-12 items-center gap-2 px-3 py-2"
              >
                <span className="flex-1" dir="ltr">
                  {c.business_date}
                </span>
                <span
                  className={
                    c.difference_paisa < 0
                      ? 'text-danger'
                      : c.difference_paisa > 0
                        ? 'text-warning'
                        : 'text-success'
                  }
                  dir="ltr"
                >
                  {c.difference_paisa === 0 ? t('closing.exact') : rs(c.difference_paisa)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
