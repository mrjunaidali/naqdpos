import {
  businessDate,
  businessDateFor,
  customRange,
  datesBetween,
  dayClosedNotice,
  presetRange,
  SALES_PRESETS,
  salesRangeFromParams,
  salesRangeSearch,
  sumPaisa,
  type SalesPreset,
  type SalesRange,
  type SalesRangeError,
} from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useRetryingLiveQuery } from '../../db/retry.ts';
import { getStoredDevice } from '../../db/session.ts';
import { intlLocale, useDates } from '../../i18n/format.ts';
import { Alert } from '../../ui/Button.tsx';
import { useClosedDates } from '../closing/closedDates.ts';
import { SaleDetail } from './SaleDetail.tsx';
import { readSalesOn, useSaleBundle } from './saleData.ts';
import { useRs } from './saleFormat.ts';
import { useViewer, visibleTo } from './saleVisibility.ts';

/**
 * Sales (Home → "See all"): the business date new sales go to by default. Owners can pick
 * Yesterday, This week or a custom range of up to 31 days, with older history in Reports; cashiers
 * see only their own sales of the open business day since the last Day Close (US018). Dexie only,
 * one single-field read per day (readSalesOn).
 */
export function SalesListPage() {
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const rs = useRs();
  const viewer = useViewer();
  const closed = useClosedDates();
  const [params, setParams] = useSearchParams();
  const calendarToday = businessDate();
  const current = closed ? businessDateFor(new Date(), closed) : undefined;
  const range =
    current && viewer.ready ? salesRangeFromParams(params, current, viewer.isOwner) : undefined;
  const sales = useRetryingLiveQuery(async () => {
    if (!range) return undefined;
    const device = await getStoredDevice();
    if (!device) return [];
    return readSalesOn(datesBetween(range.from, range.to), device.shop_id);
  }, [range?.from, range?.to]);
  if (!sales || !range || !current) return null;

  const mine = sales.filter((s) => visibleTo(s, viewer.staffId, viewer.isOwner));
  const oneDay = range.from === range.to;
  const isCurrent = oneDay && range.from === current;
  const time = new Intl.DateTimeFormat(intlLocale(i18n.language), {
    timeZone: 'Asia/Karachi',
    timeStyle: 'short',
  });
  const closedNotice = dayClosedNotice(calendarToday, current);
  const back = salesRangeSearch(range);

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">
        {oneDay
          ? t('sales.titleDay', { date: dates.date(range.from) })
          : t('sales.titleRange', { from: dates.date(range.from), to: dates.date(range.to) })}
      </h1>
      {closedNotice && (
        <Alert tone="info">{t('sales.dayClosed', { date: dates.date(closedNotice) })}</Alert>
      )}
      {viewer.isOwner && (
        <RangePicker
          range={range}
          current={current}
          onPick={(search) => setParams(new URLSearchParams(search), { replace: true })}
        />
      )}
      <p className="text-muted">
        {!viewer.isOwner
          ? t('sales.yoursDay')
          : isCurrent
            ? t('sales.allToday')
            : t('sales.allRange')}
      </p>
      <div className="rounded-2xl bg-hero p-4 text-hero-fg">
        <p className="text-sm text-hero-muted">{t('sales.count', { count: mine.length })}</p>
        <p className="text-3xl font-bold" dir="ltr">
          {rs(sumPaisa(mine.map((s) => s.total_paisa)))}
        </p>
      </div>
      {mine.length === 0 ? (
        <p className="text-muted">{isCurrent ? t('sales.none') : t('sales.noneRange')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {mine.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sales/${s.id}`}
                state={{ salesSearch: back }}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-2"
              >
                <span>
                  <span className="block font-medium" dir="ltr">
                    {s.receipt_no}
                  </span>
                  <span className="block text-sm text-muted">
                    {oneDay
                      ? time.format(new Date(s.created_at))
                      : `${dates.date(s.business_date)} · ${time.format(new Date(s.created_at))}`}
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
      {viewer.isOwner && (
        <Link
          to="/reports/monthly"
          className="inline-flex min-h-11 items-center text-text underline"
        >
          {t('sales.seeOlder')}
        </Link>
      )}
    </section>
  );
}

/** Owner only: Today / Yesterday / This week / Custom (up to 31 days). */
function RangePicker(props: {
  range: SalesRange;
  current: string;
  onPick: (search: string) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const [custom, setCustom] = useState(props.range.preset === 'custom');
  const [from, setFrom] = useState(props.range.from);
  const [to, setTo] = useState(props.range.to);
  const [error, setError] = useState<SalesRangeError>();

  const pick = (preset: Exclude<SalesPreset, 'custom'>) => {
    setCustom(false);
    setError(undefined);
    props.onPick(salesRangeSearch(presetRange(preset, props.current)));
  };
  const apply = () => {
    const checked = customRange(from, to, props.current);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setError(undefined);
    props.onPick(salesRangeSearch(checked));
  };
  const active = custom ? 'custom' : props.range.preset;

  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('sales.range.label')} className="flex flex-wrap gap-2">
        {SALES_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={active === preset}
            onClick={() => (preset === 'custom' ? setCustom(true) : pick(preset))}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
              active === preset
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface text-text'
            }`}
          >
            {t(`sales.range.${preset}`)}
          </button>
        ))}
      </div>
      {custom && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label className="flex flex-col text-sm">
            {t('sales.from')}
            <input
              type="date"
              value={from}
              max={props.current}
              onChange={(e) => setFrom(e.target.value)}
              className="min-h-11 rounded-md border border-border bg-surface px-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('sales.to')}
            <input
              type="date"
              value={to}
              max={props.current}
              onChange={(e) => setTo(e.target.value)}
              className="min-h-11 rounded-md border border-border bg-surface px-2"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-md bg-primary px-4 font-semibold text-primary-fg"
          >
            {t('sales.show')}
          </button>
        </form>
      )}
      {error && (
        <Alert>{t(`sales.rangeError.${error}`, { date: dates.date(props.current) })}</Alert>
      )}
    </div>
  );
}

/** One sale (from the list). A cashier cannot open someone else's sale. */
export function SaleViewPage() {
  const { t } = useTranslation();
  const { saleId } = useParams();
  const bundle = useSaleBundle(saleId);
  const viewer = useViewer();
  // The list's range, so "Back to sales" returns to it.
  const location = useLocation();
  const backSearch = (location.state as { salesSearch?: string } | null)?.salesSearch ?? '';
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
      <Link
        to={`/sales${backSearch}`}
        className="inline-flex min-h-11 items-center text-text underline"
      >
        {t('sales.back')}
      </Link>
    </section>
  );
}
