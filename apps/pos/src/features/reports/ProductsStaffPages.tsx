import {
  displayName,
  productsCsv,
  rangePreset,
  staffCsv,
  type ProductReportResponse,
  type StaffReportResponse,
} from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { useCurrentBusinessDate } from '../closing/closedDates.ts';
import { useQtyText, useRs } from '../sale/saleFormat.ts';
import { downloadCsv } from './download.ts';
import { useReport } from './reportsData.ts';
import { RangePicker, ReportView, SortableTable, type Column, type Range } from './reportUi.tsx';

type ProductRow = ProductReportResponse[number];
type StaffRow = StaffReportResponse[number];

/** US049: sales by product (custom items flagged), sortable, CSV. */
export function ProductsReportPage() {
  const today = useCurrentBusinessDate();
  return today ? <ProductsReport today={today} /> : null;
}

function ProductsReport({ today }: { today: string }) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const qty = useQtyText();
  const [range, setRange] = useState<Range>(rangePreset('this_month', today));
  const state = useReport('products', range.from, range.to);
  const columns: Column<ProductRow>[] = [
    {
      key: 'name',
      label: t('reports.col.product'),
      value: (r) => displayName(r, i18n.language),
      render: (r) => (
        <>
          {displayName(r, i18n.language)}
          {r.custom && <span className="ms-2 text-xs text-muted">{t('reports.custom')}</span>}
        </>
      ),
    },
    {
      key: 'qty',
      label: t('reports.col.qty'),
      value: (r) => r.qty_milli,
      render: (r) => qty(r.qty_milli, r.unit),
      numeric: true,
    },
    {
      key: 'sales',
      label: t('reports.col.sales'),
      value: (r) => r.sales_paisa,
      render: (r) => rs(r.sales_paisa),
      numeric: true,
    },
    {
      key: 'cost',
      label: t('reports.col.cost'),
      value: (r) => r.cost_paisa,
      render: (r) => rs(r.cost_paisa),
      numeric: true,
    },
    {
      key: 'profit',
      label: t('reports.col.profit'),
      value: (r) => r.profit_paisa,
      render: (r) => rs(r.profit_paisa),
      numeric: true,
    },
    {
      key: 'uncosted',
      label: t('reports.col.uncosted'),
      value: (r) => r.uncosted_sales_paisa,
      render: (r) => (r.uncosted_sales_paisa ? rs(r.uncosted_sales_paisa) : '—'),
      numeric: true,
    },
  ];
  return (
    <div className="space-y-4">
      <RangePicker today={today} value={range} onChange={setRange} />
      <ReportView state={state}>
        {(rows) => (
          <>
            <SortableTable rows={rows} columns={columns} rowKey={(r) => r.key} initial="sales" />
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(`products-${range.from}-${range.to}.csv`, productsCsv(rows))
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

/** US049: sales by staff member, sortable, CSV. */
export function StaffReportPage() {
  const today = useCurrentBusinessDate();
  return today ? <StaffReport today={today} /> : null;
}

function StaffReport({ today }: { today: string }) {
  const { t } = useTranslation();
  const rs = useRs();
  const [range, setRange] = useState<Range>(rangePreset('this_month', today));
  const state = useReport('staff', range.from, range.to);
  const columns: Column<StaffRow>[] = [
    { key: 'name', label: t('reports.col.staff'), value: (r) => r.name },
    {
      key: 'count',
      label: t('reports.col.salesCount'),
      value: (r) => r.sales_count,
      numeric: true,
    },
    {
      key: 'sales',
      label: t('reports.col.sales'),
      value: (r) => r.sales_paisa,
      render: (r) => rs(r.sales_paisa),
      numeric: true,
    },
    {
      key: 'discount',
      label: t('reports.col.discounts'),
      value: (r) => r.discount_paisa,
      render: (r) => rs(r.discount_paisa),
      numeric: true,
    },
    {
      key: 'foc',
      label: t('reports.col.foc'),
      value: (r) => r.foc_value_paisa,
      render: (r) => rs(r.foc_value_paisa),
      numeric: true,
    },
  ];
  return (
    <div className="space-y-4">
      <RangePicker today={today} value={range} onChange={setRange} />
      <ReportView state={state}>
        {(rows) => (
          <>
            <SortableTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.staff_id}
              initial="sales"
            />
            <Button
              variant="secondary"
              onClick={() => downloadCsv(`staff-${range.from}-${range.to}.csv`, staffCsv(rows))}
            >
              {t('reports.csv')}
            </Button>
          </>
        )}
      </ReportView>
    </div>
  );
}
