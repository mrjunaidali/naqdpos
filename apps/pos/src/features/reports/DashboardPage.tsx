import { displayName, rangePreset, type ProductUnit } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCurrentBusinessDate } from '../closing/closedDates.ts';
import { useQtyText, useRs } from '../sale/saleFormat.ts';
import { useReport } from './reportsData.ts';
import { methodLabel, useReportNames } from './reportText.ts';
import { AmountRow, Card, RangePicker, ReportView, type Range } from './reportUi.tsx';

/** US048: the owner dashboard for a date range, from the server (all devices). */
export function DashboardPage() {
  const today = useCurrentBusinessDate();
  return today ? <Dashboard today={today} /> : null;
}

function Dashboard({ today }: { today: string }) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const qty = useQtyText();
  const names = useReportNames();
  const [range, setRange] = useState<Range>(rangePreset('today', today));
  const summary = useReport('summary', range.from, range.to);
  const products = useReport('products', range.from, range.to);

  return (
    <div className="space-y-4">
      <RangePicker today={today} value={range} onChange={setRange} />
      <ReportView state={summary}>
        {(s) => (
          <>
            <div className="rounded-2xl bg-hero p-4 text-hero-fg">
              <p className="text-sm text-hero-muted">
                {t('reports.netSales')}
                {s.today_open && ` · ${t('reports.todayOpen')}`}
              </p>
              <p className="text-3xl font-bold" dir="ltr">
                {rs(s.net_sales_paisa)}
              </p>
              <p className="text-sm text-hero-muted">
                {t('home.invoices', { count: s.sales_count })}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card title={t('reports.payments')}>
                {s.payments_by_method.length === 0 && (
                  <p className="text-muted">{t('reports.empty')}</p>
                )}
                {s.payments_by_method.map((p) => (
                  <AmountRow
                    key={p.key}
                    label={methodLabel(names, p.key, t)}
                    amount={rs(p.amount_paisa)}
                  />
                ))}
                <AmountRow label={t('reports.khataGiven')} amount={rs(s.khata_given_paisa)} />
              </Card>
              <Card title={t('reports.profit')}>
                <AmountRow
                  label={t('reports.costedProfit')}
                  amount={rs(s.costed_profit_paisa)}
                  strong
                />
                <AmountRow label={t('reports.costedSales')} amount={rs(s.costed_sales_paisa)} />
                <UncostedNote s={s} ownerDevice={names?.ownerDevice ?? false} />
              </Card>
              <Card title={t('reports.expensesAndWastage')}>
                <AmountRow label={t('reports.expenses')} amount={rs(s.expenses_total_paisa)} />
                <AmountRow label={t('reports.wastage')} amount={rs(s.wastage_value_paisa)} />
              </Card>
              <Card title={t('reports.khataDue')}>
                <AmountRow
                  label={t('reports.receivables')}
                  amount={rs(s.receivables_paisa)}
                  strong
                />
                <p className="text-sm text-muted">
                  {t('reports.receivableCustomers', { count: s.receivable_customers })}
                </p>
                <AmountRow label={t('reports.khataReceived')} amount={rs(s.khata_received_paisa)} />
                <Link to="/khata" className="inline-flex min-h-11 items-center underline">
                  {t('nav.khata')}
                </Link>
              </Card>
            </div>
          </>
        )}
      </ReportView>
      <Card title={t('reports.topProducts')}>
        <ReportView state={products}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-muted">{t('reports.empty')}</p>
            ) : (
              <ol className="divide-y divide-border">
                {rows.slice(0, 5).map((p) => (
                  <li key={p.key} className="flex justify-between gap-3 py-2">
                    <span>
                      {displayName(p, i18n.language)}
                      {p.custom && (
                        <span className="ms-2 text-sm text-muted">{t('reports.custom')}</span>
                      )}
                      <span className="ms-2 text-sm text-muted">
                        {qty(p.qty_milli, p.unit as ProductUnit)}
                      </span>
                    </span>
                    <span dir="ltr">{rs(p.sales_paisa)}</span>
                  </li>
                ))}
              </ol>
            )
          }
        </ReportView>
      </Card>
    </div>
  );
}

/** "Sales without a cost price: Rs Z" with the link to add cost prices. */
export function UncostedNote({
  s,
  ownerDevice,
}: {
  s: { uncosted_sales_paisa: number; uncosted_lines: number; uncosted_products: number };
  ownerDevice: boolean;
}) {
  const { t } = useTranslation();
  const rs = useRs();
  if (s.uncosted_lines === 0) return null;
  return (
    <div className="space-y-1 rounded-md bg-warning-soft p-2 text-warning-fg">
      <AmountRow label={t('reports.uncostedSales')} amount={rs(s.uncosted_sales_paisa)} />
      <p className="text-sm">
        {t('reports.uncostedCount', { lines: s.uncosted_lines, products: s.uncosted_products })}
      </p>
      <Link
        to={ownerDevice ? '/products/rates' : '/products'}
        className="inline-flex min-h-11 items-center underline"
      >
        {t('reports.addCostPrices')}
      </Link>
    </div>
  );
}
