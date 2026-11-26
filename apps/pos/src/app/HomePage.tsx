import { can, formatPkMobile, type Role } from '@naqdpos/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';
import { greetingKey, useHomeData, type HomeData } from '../features/home/homeData.ts';
import { AFTER_SETUP_KEY } from '../features/onboarding/setup.ts';
import { useRs } from '../features/sale/saleFormat.ts';
import { useDates } from '../i18n/format.ts';
import { useCurrentStaff } from '../staff/currentStaff.ts';
import { SyncChip } from '../sync/SyncChip.tsx';
import { Button } from '../ui/Button.tsx';
import { InstallCard } from './InstallCard.tsx';
import { STORAGE_NOTICE_KEY, STORAGE_PERSISTED_KEY } from './storage.ts';
import { useRetryingLiveQuery } from '../db/retry.ts';

const card = 'rounded-2xl border border-border bg-surface p-4';

/**
 * Home (design-theme.md "Screens → Home"; US002). From Dexie only. Owners: the shop's day with a
 * 7-day trend, khata owed and low stock. Cashiers: their own sales today, no trend.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const current = useCurrentStaff();
  const staff = current?.valid ? current.staff : null;
  const role = staff?.role ?? null;
  const isOwner = role === 'owner';
  const loaded = useHomeData(staff?.id, !isOwner);
  // Wait for who is working: otherwise an owner briefly sees the cashier view.
  const data = current === undefined ? undefined : loaded;
  const info = useRetryingLiveQuery(async () => {
    const device = await getStoredDevice();
    const shop = device ? await db.shops.get(device.shop_id) : undefined;
    return { shopName: shop?.name ?? null, code: device?.code ?? null };
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
    <section className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t(`home.greeting.${greetingKey()}`)}</h1>
        {info?.shopName && <p className="text-muted">{info.shopName}</p>}
        {info?.code && (
          <p className="text-sm text-muted">{t('home.deviceCode', { code: info.code })}</p>
        )}
      </div>
      {data && <Hero data={data} owner={isOwner} />}
      {data && isOwner && <StatCards data={data} />}
      <Tiles role={role} />
      {isOwner && <StorageNotice />}
      <InstallCard dismissible />
      {data && <Recent data={data} />}
    </section>
  );
}

function Hero({ data, owner }: { data: HomeData; owner: boolean }) {
  const { t } = useTranslation();
  const dates = useDates();
  const rs = useRs();
  const { totals, trend } = data;
  const max = trend.max_paisa || 1;
  return (
    <div className="space-y-3 rounded-2xl bg-hero p-4 text-hero-fg">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-hero-muted">
          {data.rolled
            ? t('home.salesFor', { date: dates.date(data.date) })
            : owner
              ? t('home.todaySales')
              : t('home.mySales')}
        </p>
        <SyncChip />
      </div>
      <p className="text-4xl font-bold" dir="ltr">
        {rs(totals.total_paisa)}
      </p>
      <p className="text-sm text-hero-muted">{t('home.invoices', { count: totals.invoices })}</p>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        {(
          [
            ['cash', totals.cash_paisa],
            ['other', totals.other_paisa],
            ['khata', totals.khata_paisa],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-xl bg-hero-fg/10 p-2">
            <dt className="text-hero-muted">{t(`home.split.${key}`)}</dt>
            <dd className="font-semibold" dir="ltr">
              {rs(value)}
            </dd>
          </div>
        ))}
      </dl>
      {data.rolled && (
        <p className="text-sm">{t('closing.banner', { date: dates.date(data.date) })}</p>
      )}
      {owner && (
        <div
          aria-label={t('home.trend')}
          role="img"
          className="flex h-16 items-end gap-1"
          dir="ltr"
        >
          {trend.days.map((d) => (
            <span
              key={d.date}
              title={`${dates.date(d.date)}: ${rs(d.total_paisa)}`}
              data-today={d.isToday || undefined}
              className={`flex-1 rounded-t ${d.isToday ? 'bg-hero-fg' : 'bg-hero-fg/30'}`}
              style={{ height: `${Math.max(4, Math.round((d.total_paisa / max) * 100))}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCards({ data }: { data: HomeData }) {
  const { t } = useTranslation();
  const rs = useRs();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Link to="/khata" className={`${card} block`}>
        <span className="block text-sm text-muted">{t('home.khataOwed')}</span>
        <span className="block text-xl font-bold" dir="ltr">
          {rs(data.receivable_paisa)}
        </span>
      </Link>
      <Link to="/stock" className={`${card} block`}>
        <span className="block text-sm text-muted">{t('home.lowStock')}</span>
        <span className={`block text-xl font-bold ${data.lowStock > 0 ? 'text-warning' : ''}`}>
          {data.lowStock}
        </span>
      </Link>
    </div>
  );
}

function Tiles({ role }: { role: Role | null }) {
  const { t } = useTranslation();
  const tiles = [
    can(role, 'manage_products') && { key: 'product', to: '/products/new' },
    can(role, 'use_khata') && { key: 'customer', to: '/khata?add=1' },
    can(role, 'adjust_stock')
      ? { key: 'stockIn', to: '/stock' }
      : can(role, 'record_wastage') && { key: 'wastage', to: '/stock' },
    can(role, 'add_expense') && { key: 'expense', to: '/expenses/new' },
  ].filter((x): x is { key: string; to: string } => Boolean(x));
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          to={tile.to}
          className="flex min-h-16 items-center justify-center rounded-2xl border border-border bg-surface p-2 text-center text-sm font-semibold text-text"
        >
          {t(`home.tile.${tile.key}`)}
        </Link>
      ))}
    </div>
  );
}

function StorageNotice() {
  const { t } = useTranslation();
  const show = useRetryingLiveQuery(async () => {
    const persisted = (await db.meta.get(STORAGE_PERSISTED_KEY))?.value;
    const shown = (await db.meta.get(STORAGE_NOTICE_KEY))?.value === true;
    return persisted === false && !shown;
  });
  if (!show) return null;
  return (
    <div
      role="status"
      className="space-y-2 rounded-2xl border border-warning bg-warning-soft p-4 text-warning-fg"
    >
      <p>{t('home.storageNotice')}</p>
      <Button
        className="w-auto"
        variant="secondary"
        onClick={() => void db.meta.put({ key: STORAGE_NOTICE_KEY, value: true })}
      >
        {t('home.gotIt')}
      </Button>
    </div>
  );
}

function Recent({ data }: { data: HomeData }) {
  const { t } = useTranslation();
  const rs = useRs();
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  const who = (id: string | null) => {
    const c = id ? data.customers.get(id) : undefined;
    return c ? (c.name ?? formatPkMobile(c.mobile)) : null;
  };
  return (
    <div className={card}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{t('home.recent')}</h2>
        <Link to="/sales" className="inline-flex min-h-11 items-center text-sm underline">
          {t('home.seeAll')}
        </Link>
      </div>
      {data.recent.length === 0 ? (
        <p className="text-sm text-muted">{t('home.nothingYet')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.recent.map((item) => (
            <li key={item.id}>
              <Link
                to={item.kind === 'sale' ? `/sales/${item.id}` : `/khata/${item.customer_id}`}
                className="flex min-h-12 items-center gap-2 py-1"
              >
                <span className="w-12 text-sm text-muted" dir="ltr">
                  {time(item.at)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {item.kind === 'sale' ? item.receipt_no : t(`khata.type.${item.type}`)}
                  {who(item.customer_id) && (
                    <span className="text-muted"> · {who(item.customer_id)}</span>
                  )}
                </span>
                <span className="font-semibold" dir="ltr">
                  {rs(item.amount_paisa)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
