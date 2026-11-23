import { describe, expect, it } from 'vitest';
import { expectedCash } from './closing.ts';
import { expenseTotals } from './expenses.ts';
import fixture from './fixtures/report-month.json' with { type: 'json' };
import { receivableTotal } from './home.ts';
import {
  costAt,
  expenseReport,
  firstOfMonth,
  lastOfMonth,
  pnlCsv,
  previousPeriod,
  productReport,
  productsCsv,
  profitAndLoss,
  rangePreset,
  reportSummary,
  staffReport,
  toCsv,
  validateRange,
  valueLines,
  type ReportInput,
} from './reports.ts';

const input: ReportInput = {
  sales: fixture.sales,
  lines: fixture.lines,
  payments: fixture.payments,
  khata: fixture.khata,
  movements: fixture.movements,
  expenses: fixture.expenses,
  costs: fixture.costs,
  closedDates: fixture.closed_dates,
  products: fixture.products,
  categories: fixture.categories,
  staff: fixture.staff,
};
const { from, to, today, expected } = fixture;

describe('shared fixture (same expected values as the SQL report functions)', () => {
  it('summary', () => {
    expect(reportSummary(input, from, to, today)).toEqual(expected.summary);
  });

  it('products, custom items grouped by name and flagged', () => {
    const rows = productReport(input, from, to);
    expect(rows).toEqual(expected.products.map((p) => expect.objectContaining(p) as unknown));
  });

  it('staff', () => {
    expect(staffReport(input, from, to)).toEqual(expected.staff);
  });

  it('expenses: newest first, reversals netted, previous month', () => {
    const r = expenseReport(input, from, to);
    expect(r.lines.map((l) => l.id)).toEqual(expected.expenses.line_ids);
    expect(r).toMatchObject({
      total_paisa: expected.expenses.total_paisa,
      by_category: expected.expenses.by_category,
      by_method: expected.expenses.by_method,
      previous: expected.expenses.previous,
    });
    // Agrees with expenseTotals (the closing / expenses screens).
    const totals = expenseTotals(input.expenses, { from, to });
    expect(totals.total_paisa).toBe(r.total_paisa);
    expect(Object.fromEntries(totals.byCategory)).toEqual(
      Object.fromEntries(r.by_category.map((c) => [c.key, c.amount_paisa])),
    );
  });

  it('receivables agree with receivableTotal; expected cash per day with expectedCash', () => {
    expect(receivableTotal(input.khata.filter((k) => k.business_date <= to))).toBe(
      expected.summary.receivables_paisa,
    );
    for (const day of expected.expected_cash) {
      expect(
        expectedCash({
          openingPaisa: day.opening_paisa,
          withdrawalPaisa: day.withdrawal_paisa,
          payments: input.payments.filter(
            (p) => p.business_date === day.business_date,
          ) as Parameters<typeof expectedCash>[0]['payments'],
          expenses: input.expenses.filter((e) => e.business_date === day.business_date),
        }),
        day.business_date,
      ).toBe(day.expected_paisa);
    }
  });
});

describe('cost of goods and the sales split', () => {
  it('cost in effect at the sale time; none before the first cost row', () => {
    const mango = fixture.products[0]!.id;
    expect(costAt(input.costs, mango, '2026-10-14T18:59:59Z')).toBe(20000);
    expect(costAt(input.costs, mango, '2026-10-14T19:00:00Z')).toBe(25000);
    expect(costAt(input.costs, mango, '2026-08-01T00:00:00Z')).toBeNull();
    expect(costAt(input.costs, null, '2026-10-14T19:00:00Z')).toBeNull();
  });

  it('bill discount and rounding are shared across lines exactly', () => {
    const valued = valueLines(input.sales, input.lines, input.costs);
    for (const sale of input.sales) {
      const own = valued.filter((l) => l.sale_id === sale.id);
      expect(own.reduce((s, l) => s + l.net_paisa, 0)).toBe(sale.total_paisa);
    }
  });

  it('FOC lines add their cost; costed + uncosted sales = net sales', () => {
    const s = reportSummary(input, from, to, today);
    expect(s.costed_sales_paisa + s.uncosted_sales_paisa).toBe(s.net_sales_paisa);
    const coriander = productReport(input, from, to).find((p) => p.name === 'Coriander')!;
    expect(coriander).toMatchObject({ sales_paisa: 0, cost_paisa: 1000, profit_paisa: -1000 });
  });

  it('today in the range and not closed is "still open", never in the unclosed days', () => {
    const s = reportSummary(input, '2026-10-01', '2026-10-31', '2026-10-20');
    expect(s.unclosed_days).toEqual([]);
    expect(s.today_open).toBe(true);
    const later = reportSummary(input, '2026-10-01', '2026-10-31', '2026-10-21');
    expect(later.unclosed_days).toEqual(['2026-10-20']);
    expect(later.today_open).toBe(false); // 21 Oct is closed
  });
});

describe('P&L', () => {
  it('gross profit on costed items, sales without cost apart, net excludes them', () => {
    const { lines, excludesUncosted } = profitAndLoss(expected.summary);
    expect(excludesUncosted).toBe(true);
    const amount = (key: string) => lines.find((l) => l.key === key)?.amount_paisa;
    expect(amount('net_sales')).toBe(238300);
    expect(amount('uncosted_sales')).toBe(90543);
    expect(amount('gross_profit')).toBe(35932);
    expect(amount('net')).toBe(35932 - 2530000 - 12500);
    expect(lines.filter((l) => l.key === 'expense').map((l) => l.category?.name)).toEqual([
      'Rent',
      'Bags',
    ]);
    const csv = pnlCsv(expected.summary);
    expect(csv).toContain('Net (excluding sales without cost price),-25065.68\r\n');
    expect(csv).toContain('Sales without cost price,905.43\r\n');
  });

  it('no "excluding" label when every line has a cost price', () => {
    const all = { ...expected.summary, uncosted_sales_paisa: 0, uncosted_lines: 0 };
    expect(profitAndLoss(all).excludesUncosted).toBe(false);
    expect(pnlCsv(all)).toContain('\r\nNet,');
  });
});

describe('ranges', () => {
  it('presets around today (weeks start on Monday)', () => {
    // 2026-11-25 is a Wednesday.
    expect(rangePreset('today', '2026-11-25')).toEqual({ from: '2026-11-25', to: '2026-11-25' });
    expect(rangePreset('yesterday', '2026-11-01')).toEqual({
      from: '2026-10-31',
      to: '2026-10-31',
    });
    expect(rangePreset('this_week', '2026-11-25')).toEqual({
      from: '2026-11-23',
      to: '2026-11-25',
    });
    expect(rangePreset('this_week', '2026-11-23').from).toBe('2026-11-23');
    expect(rangePreset('this_month', '2026-11-25')).toEqual({
      from: '2026-11-01',
      to: '2026-11-25',
    });
    expect(rangePreset('last_month', '2026-03-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('previous period: the previous calendar month, or the same length before', () => {
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(previousPeriod('2026-11-10', '2026-11-16')).toEqual({
      from: '2026-11-03',
      to: '2026-11-09',
    });
    expect(firstOfMonth('2028-02-14')).toBe('2028-02-01');
    expect(lastOfMonth('2028-02-14')).toBe('2028-02-29');
  });

  it('validation: dates, order, at most 366 days', () => {
    expect(validateRange('2026-01-01', '2027-01-01')).toBeNull(); // 366 days
    expect(validateRange('2026-01-01', '2027-01-02')).toBe('too_long');
    expect(validateRange('2026-02-02', '2026-02-01')).toBe('from_after_to');
    expect(validateRange('2026-2-1', '2026-02-01')).toBe('bad_date');
  });
});

describe('CSV', () => {
  it('BOM, CRLF, quotes and commas escaped, Urdu kept', () => {
    expect(
      toCsv([
        ['a', 'b, "c"'],
        ['آم', null],
      ]),
    ).toBe('﻿a,"b, ""c"""\r\nآم,\r\n');
  });

  it('products CSV: rupees with 2 decimals, qty with 3, custom items flagged', () => {
    const csv = productsCsv(productReport(input, from, to));
    const rows = csv.slice(1).split('\r\n');
    expect(rows[0]).toBe(
      'product,name_ur,unit,custom_item,qty,free_qty,sales,sales_with_cost_price,cost_of_goods,profit,sales_without_cost_price',
    );
    expect(rows[1]).toBe('Mango,آم,kg,no,4.833,0.000,1379.04,1379.04,1033.25,345.79,0.00');
    expect(rows[2]).toBe('Basket,,piece,yes,1.000,0.000,500.08,0.00,0.00,0.00,500.08');
  });
});
