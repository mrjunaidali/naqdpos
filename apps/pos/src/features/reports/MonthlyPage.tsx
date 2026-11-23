import { lastOfMonth, pnlCsv, profitAndLoss, type PnlLine } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../ui/Button.tsx';
import { useCurrentBusinessDate } from '../closing/closedDates.ts';
import { useRs } from '../sale/saleFormat.ts';
import { UncostedNote } from './DashboardPage.tsx';
import { downloadCsv } from './download.ts';
import { useReport } from './reportsData.ts';
import { categoryLabel, useReportNames } from './reportText.ts';
import { AmountRow, Card, ReportView } from './reportUi.tsx';

/** US047: the monthly profit & loss for a calendar month (by business date). */
export function MonthlyPage() {
  const today = useCurrentBusinessDate();
  return today ? <Monthly today={today} /> : null;
}

const STRONG = new Set<PnlLine['key']>(['net_sales', 'gross_profit', 'expenses_total', 'net']);

function Monthly({ today }: { today: string }) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const names = useReportNames();
  const [month, setMonth] = useState(today.slice(0, 7));
  const from = `${month}-01`;
  const to = lastOfMonth(from);
  const state = useReport('summary', from, to);

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 print:hidden">
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
        {(s) => {
          const { lines, excludesUncosted } = profitAndLoss(s);
          const label = (l: PnlLine) =>
            l.key === 'expense' && l.category
              ? categoryLabel(l.category, t, i18n.language)
              : l.key === 'net' && excludesUncosted
                ? t('reports.pnl.netExcluding')
                : t(`reports.pnl.${l.key}`);
          return (
            <>
              {s.unclosed_days.length > 0 && (
                <Alert tone="info">
                  {t('reports.unclosedDays', { days: s.unclosed_days.join(', ') })}
                </Alert>
              )}
              {s.today_open && <p className="text-muted">{t('reports.todayOpen')}</p>}
              <div className="report-print space-y-4">
                <Card title={t('reports.pnlTitle', { month })}>
                  {lines.map((l, i) => (
                    <div
                      key={`${l.key}-${i}`}
                      className={
                        l.key === 'expense'
                          ? 'ps-4'
                          : STRONG.has(l.key)
                            ? 'border-t border-border'
                            : ''
                      }
                    >
                      <AmountRow
                        label={label(l)}
                        amount={rs(l.amount_paisa)}
                        strong={STRONG.has(l.key)}
                      />
                    </div>
                  ))}
                  <div className="border-t border-border">
                    <AmountRow
                      label={t('reports.receivablesAtEnd')}
                      amount={rs(s.receivables_paisa)}
                    />
                  </div>
                </Card>
                <div className="print:hidden">
                  <UncostedNote s={s} ownerDevice={names?.ownerDevice ?? false} />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 print:hidden">
                <Button variant="secondary" onClick={() => window.print()}>
                  {t('reports.print')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => downloadCsv(`profit-and-loss-${month}.csv`, pnlCsv(s))}
                >
                  {t('reports.csv')}
                </Button>
              </div>
            </>
          );
        }}
      </ReportView>
    </div>
  );
}
