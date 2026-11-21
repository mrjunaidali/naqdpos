import {
  DEFAULT_OVERDUE_DAYS,
  formatPkMobile,
  isOverdue,
  khataBalance,
  sumPaisa,
  telLink,
  waLink,
} from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../ui/Button.tsx';
import { CustomerPicker } from './CustomerPicker.tsx';
import { useRs } from '../sale/saleFormat.ts';
import { matchCustomers } from './customerSearch.ts';
import { useBalances, useCustomers } from './khataRepo.ts';

const iconLink =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-sm font-medium';

/**
 * Khata (US041): customers who owe (or are owed), highest balance first, the total receivable,
 * an overdue filter (no payment for N days; not stored), search, call and WhatsApp.
 */
export function KhataListPage() {
  const { t } = useTranslation();
  const rs = useRs();
  const customers = useCustomers();
  const balances = useBalances();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [daysText, setDaysText] = useState(String(DEFAULT_OVERDUE_DAYS));
  if (!customers || !balances) return null;

  const days = /^\d{1,4}$/.test(daysText) ? Number(daysText) : DEFAULT_OVERDUE_DAYS;
  const now = new Date();
  const rows = customers
    .map((c) => {
      const entries = balances.get(c.id) ?? [];
      return {
        customer: c,
        balance: khataBalance(entries),
        overdue: isOverdue(entries, now, days),
      };
    })
    .filter((r) => r.balance !== 0);
  const receivable = sumPaisa(rows.filter((r) => r.balance > 0).map((r) => r.balance));
  const matched = new Set(matchCustomers(customers, query).map((c) => c.id));
  const shown = rows
    .filter((r) => matched.has(r.customer.id) && (!overdueOnly || r.overdue))
    .sort((a, b) => b.balance - a.balance);

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('khata.title')}</h1>
        <Button className="w-auto" onClick={() => setAdding(true)}>
          {t('khata.addCustomer')}
        </Button>
      </div>
      {adding && (
        <CustomerPicker
          startAdding
          onClose={() => setAdding(false)}
          onPick={(c) => {
            setAdding(false);
            // A mobile that already exists opens that customer.
            void navigate(`/khata/${c.id}`);
          }}
        />
      )}
      <div className="rounded-2xl bg-hero p-4 text-hero-fg">
        <p className="text-sm text-hero-muted">{t('khata.receivable')}</p>
        <p className="text-3xl font-bold" dir="ltr">
          {rs(receivable)}
        </p>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('customers.searchPlaceholder')}
        aria-label={t('customers.search')}
        className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-lg"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="size-5 accent-primary"
          />
          {t('khata.overdueOnly')}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          {t('khata.noPaymentFor')}
          <input
            inputMode="numeric"
            dir="ltr"
            value={daysText}
            onChange={(e) => setDaysText(e.target.value)}
            aria-label={t('khata.days')}
            className="min-h-11 w-20 rounded-md border border-border bg-surface px-2 text-center"
          />
          {t('khata.daysUnit')}
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted">{rows.length === 0 ? t('khata.empty') : t('khata.noMatch')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {shown.map(({ customer, balance, overdue }) => {
            const label = customer.name ?? formatPkMobile(customer.mobile);
            return (
              <li key={customer.id} className="flex items-center gap-2 px-3 py-2">
                <Link to={`/khata/${customer.id}`} className="min-h-11 min-w-0 flex-1">
                  <span className="block truncate font-semibold">{label}</span>
                  <span className="block text-sm text-muted" dir="ltr">
                    {formatPkMobile(customer.mobile)}
                  </span>
                </Link>
                <span className="text-end">
                  <span className="block font-semibold" dir="ltr">
                    {rs(balance)}
                  </span>
                  {overdue && (
                    <span className="block text-xs font-semibold text-warning">
                      {t('khata.overdue')}
                    </span>
                  )}
                </span>
                <a
                  href={telLink(customer.mobile)}
                  className={iconLink}
                  aria-label={t('khata.call', { name: label })}
                >
                  📞
                </a>
                <a
                  href={waLink(customer.mobile)}
                  target="_blank"
                  rel="noreferrer"
                  className={iconLink}
                  aria-label={t('khata.whatsapp', { name: label })}
                >
                  💬
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
