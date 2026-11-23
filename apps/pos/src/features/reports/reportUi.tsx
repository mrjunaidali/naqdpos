import { RANGE_PRESETS, rangePreset, type RangePreset } from '@naqdpos/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDates } from '../../i18n/format.ts';
import { Alert } from '../../ui/Button.tsx';
import type { ReportState } from './reportsData.ts';

export interface Range {
  from: string;
  to: string;
}

/** Today, Yesterday, This week, This month, Last month, Custom (two dates). */
export function RangePicker({
  today,
  value,
  onChange,
}: {
  today: string;
  value: Range;
  onChange: (range: Range) => void;
}) {
  const { t } = useTranslation();
  const preset = RANGE_PRESETS.find((p) => {
    const r = rangePreset(p, today);
    return r.from === value.from && r.to === value.to;
  });
  const [custom, setCustom] = useState(!preset);
  const chip = (active: boolean) =>
    `min-h-11 rounded-full border px-4 ${active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface'}`;
  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('reports.range')} className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((p: RangePreset) => (
          <button
            key={p}
            type="button"
            aria-pressed={!custom && preset === p}
            className={chip(!custom && preset === p)}
            onClick={() => {
              setCustom(false);
              onChange(rangePreset(p, today));
            }}
          >
            {t(`reports.preset.${p}`)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          className={chip(custom)}
          onClick={() => setCustom(true)}
        >
          {t('reports.preset.custom')}
        </button>
      </div>
      {custom && (
        <div className="flex flex-wrap gap-2">
          {(['from', 'to'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              {t(`reports.${k}`)}
              <input
                type="date"
                value={value[k]}
                max={today}
                onChange={(e) => e.target.value && onChange({ ...value, [k]: e.target.value })}
                className="min-h-11 rounded-md border border-border bg-surface px-2"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Loading, offline (cached, with the time), needs internet, error; then the report. */
export function ReportView<T>({
  state,
  children,
}: {
  state: ReportState<T>;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  if (state.status === 'loading') return <p className="text-muted">{t('common.loading')}</p>;
  if (state.status === 'needs_internet')
    return <Alert tone="info">{t('reports.needsInternet')}</Alert>;
  if (state.status === 'error') return <Alert>{t('reports.error')}</Alert>;
  const time = dates.dateTime(state.asOf);
  return (
    <>
      {state.offline && <Alert tone="info">{t('reports.asOfOffline', { time })}</Alert>}
      {children(state.data)}
    </>
  );
}

/** A label + amount row (amounts stay left-to-right in Urdu). */
export function AmountRow({
  label,
  amount,
  strong,
}: {
  label: ReactNode;
  amount: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span dir="ltr">{amount}</span>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  value: (row: R) => number | string;
  render?: (row: R) => ReactNode;
  numeric?: boolean;
}

/** A table sortable by any column (tap the header; tap again to reverse). */
export function SortableTable<R>({
  rows,
  columns,
  rowKey,
  initial,
}: {
  rows: readonly R[];
  columns: readonly Column<R>[];
  rowKey: (row: R) => string;
  initial: string;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const col = columns.find((c) => c.key === sort.key) ?? columns[0]!;
  const sorted = [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    const cmp =
      typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -cmp : cmp;
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                className="p-0 text-start"
              >
                <button
                  type="button"
                  className={`min-h-11 w-full px-2 font-semibold ${c.numeric ? 'text-end' : 'text-start'}`}
                  onClick={() =>
                    setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))
                  }
                >
                  {c.label}
                  {sort.key === c.key && <span aria-hidden="true"> {sort.desc ? '▼' : '▲'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="p-2 text-muted">
                {t('reports.empty')}
              </td>
            </tr>
          )}
          {sorted.map((r) => (
            <tr key={rowKey(r)} className="border-t border-border">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`p-2 ${c.numeric ? 'text-end' : ''}`}
                  dir={c.numeric ? 'ltr' : undefined}
                >
                  {c.render ? c.render(r) : c.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
