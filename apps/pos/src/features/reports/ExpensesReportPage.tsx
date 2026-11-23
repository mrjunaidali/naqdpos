import { expensesCsv, lastOfMonth, rangePreset } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { useCurrentBusinessDate } from '../closing/closedDates.ts';
import { useDates } from '../../i18n/format.ts';
import { useRs } from '../sale/saleFormat.ts';
import { downloadCsv } from './download.ts';
import { useReport, type ReportFilters } from './reportsData.ts';
import { categoryLabel, methodLabel, useReportNames } from './reportText.ts';
import { AmountRow, Card, RangePicker, ReportView, type Range } from './reportUi.tsx';

/**
 * US068 (EXP-5): the expense list with filters (date range, category, method, staff; newest first;
 * total for the filter; CSV) and the monthly view by category against last month. Owners only;
 * cashiers keep the "own expenses today" list on the Expenses screen.
 */
export function ExpensesReportPage() {
  const today = useCurrentBusinessDate();
  const { t } = useTranslation();
  const [view, setView] = useState<'list' | 'month'>('list');
  if (!today) return null;
  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('reports.expenseView')} className="flex gap-2">
        {(['list', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`min-h-11 rounded-full border px-4 ${view === v ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface'}`}
          >
            {t(`reports.expenseViews.${v}`)}
          </button>
        ))}
      </div>
      {view === 'list' ? <ExpenseList today={today} /> : <ExpenseMonth today={today} />}
    </div>
  );
}

function ExpenseList({ today }: { today: string }) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const dates = useDates();
  const names = useReportNames();
  const [range, setRange] = useState<Range>(rangePreset('this_month', today));
  const [filters, setFilters] = useState<ReportFilters>({});
  const state = useReport('expenses', range.from, range.to, filters);
  const select = (
    key: keyof ReportFilters,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <label className="flex flex-col gap-1">
      {label}
      <select
        value={filters[key] ?? ''}
        onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value || undefined }))}
        className="min-h-11 rounded-md border border-border bg-surface px-2"
      >
        <option value="">{t('reports.all')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <RangePicker today={today} value={range} onChange={setRange} />
      <div className="grid gap-2 sm:grid-cols-3">
        {select(
          'category_id',
          t('reports.filter.category'),
          (names?.categories ?? []).map((c) => ({
            value: c.id,
            label: categoryLabel(c, t, i18n.language),
          })),
        )}
        {select(
          'method_code',
          t('reports.filter.method'),
          (names?.methods ?? []).map((m) => ({
            value: m.code,
            label: methodLabel(names, m.code, t),
          })),
        )}
        {select(
          'staff_id',
          t('reports.filter.staff'),
          (names?.staff ?? []).map((s) => ({ value: s.id, label: s.name })),
        )}
      </div>
      <ReportView state={state}>
        {(r) => (
          <>
            <div className="rounded-2xl bg-hero p-4 text-hero-fg">
              <p className="text-sm text-hero-muted">
                {t('reports.expenseTotal', { count: r.line_count })}
              </p>
              <p className="text-3xl font-bold" dir="ltr">
                {rs(r.total_paisa)}
              </p>
            </div>
            {r.lines.length === 0 ? (
              <p className="text-muted">{t('reports.empty')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
                {r.lines.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 p-3">
                    <span>
                      <span className="font-semibold">
                        {categoryLabel(
                          {
                            name: e.category_name,
                            name_ur: e.category_name_ur,
                            i18n_key: e.category_i18n_key,
                          },
                          t,
                          i18n.language,
                        )}
                      </span>
                      {e.reverses_expense_id && (
                        <span className="ms-2 text-sm text-muted">{t('reports.reversal')}</span>
                      )}
                      <span className="block text-sm text-muted">
                        {dates.date(e.business_date)} · {methodLabel(names, e.paid_method_code, t)}
                        {e.staff_name && ` · ${e.staff_name}`}
                        {e.note && ` · ${e.note}`}
                      </span>
                    </span>
                    <span dir="ltr">{rs(e.amount_paisa)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(`expenses-${range.from}-${range.to}.csv`, expensesCsv(r.lines))
              }
            >
              {t('reports.csv')}
            </Button>
          </>
        )}
      </ReportView>
    </div>
  );
}

function ExpenseMonth({ today }: { today: string }) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const names = useReportNames();
  const [month, setMonth] = useState(today.slice(0, 7));
  const from = `${month}-01`;
  const state = useReport('expenses', from, lastOfMonth(from));
  const label = (id: string) => {
    const c = names?.categories.find((x) => x.id === id);
    return c ? categoryLabel(c, t, i18n.language) : '—';
  };
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        {t('reports.month')}
        <input
          type="month"
          value={month}
          max={today.slice(0, 7)}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="min-h-11 rounded-md border border-border bg-surface px-2"
        />
      </label>
      <ReportView state={state}>
        {(r) => {
          const keys = [
            ...new Set([
              ...r.by_category.map((c) => c.key),
              ...r.previous.by_category.map((c) => c.key),
            ]),
          ];
          const amount = (list: typeof r.by_category, key: string) =>
            list.find((c) => c.key === key)?.amount_paisa ?? 0;
          return (
            <Card title={t('reports.byCategoryVsLast')}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted">
                    <th scope="col" className="p-1 text-start">
                      {t('reports.filter.category')}
                    </th>
                    <th scope="col" className="p-1 text-end">
                      {t('reports.thisMonth')}
                    </th>
                    <th scope="col" className="p-1 text-end">
                      {t('reports.lastMonth')}
                    </th>
                    <th scope="col" className="p-1 text-end">
                      {t('reports.change')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const now = amount(r.by_category, k);
                    const before = amount(r.previous.by_category, k);
                    return (
                      <tr key={k} className="border-t border-border">
                        <td className="p-1">{label(k)}</td>
                        <td className="p-1 text-end" dir="ltr">
                          {rs(now)}
                        </td>
                        <td className="p-1 text-end" dir="ltr">
                          {rs(before)}
                        </td>
                        <td className="p-1 text-end" dir="ltr">
                          {now - before > 0 ? '+' : ''}
                          {rs(now - before)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <AmountRow label={t('reports.thisMonth')} amount={rs(r.total_paisa)} strong />
              <AmountRow label={t('reports.lastMonth')} amount={rs(r.previous.total_paisa)} />
            </Card>
          );
        }}
      </ReportView>
    </div>
  );
}
