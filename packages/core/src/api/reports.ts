// Owner report API (US047–US049, US068; architecture §9). GET /reports/{summary,products,staff,
// expenses}?shop_id&from&to; products, staff and expenses also as ?format=csv. Owner only.
import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paisa = z.number().int();

export const ReportQuery = z.object({
  shop_id: z.uuid(),
  from: date,
  to: date,
  format: z.enum(['json', 'csv']).optional(),
});
export type ReportQuery = z.input<typeof ReportQuery>;

export const ExpenseReportQuery = ReportQuery.extend({
  category_id: z.uuid().optional(),
  method_code: z.string().min(1).max(40).optional(),
  staff_id: z.uuid().optional(),
});
export type ExpenseReportQuery = z.input<typeof ExpenseReportQuery>;

const AmountBy = z.object({ key: z.string(), amount_paisa: paisa });

export const ReportSummarySchema = z.object({
  from: date,
  to: date,
  sales_count: z.number().int(),
  gross_sales_paisa: paisa,
  line_discount_paisa: paisa,
  bill_discount_paisa: paisa,
  rounding_paisa: paisa,
  net_sales_paisa: paisa,
  payments_by_method: z.array(AmountBy),
  khata_receipts_by_method: z.array(AmountBy),
  khata_given_paisa: paisa,
  khata_received_paisa: paisa,
  foc_lines: z.number().int(),
  foc_value_paisa: paisa,
  costed_sales_paisa: paisa,
  cost_of_goods_paisa: paisa,
  costed_profit_paisa: paisa,
  uncosted_sales_paisa: paisa,
  uncosted_lines: z.number().int(),
  uncosted_products: z.number().int(),
  expenses_total_paisa: paisa,
  expenses_by_category: z.array(
    AmountBy.extend({
      name: z.string().nullable(),
      name_ur: z.string().nullable(),
      i18n_key: z.string().nullable(),
    }),
  ),
  wastage_value_paisa: paisa,
  wastage_unvalued_lines: z.number().int(),
  net_paisa: paisa,
  receivables_paisa: paisa,
  receivable_customers: z.number().int(),
  unclosed_days: z.array(date),
  today_open: z.boolean(),
});

export const ProductReportSchema = z.array(
  z.object({
    key: z.string(),
    product_id: z.uuid().nullable(),
    name: z.string(),
    name_ur: z.string().nullable(),
    unit: z.string(),
    custom: z.boolean(),
    lines: z.number().int(),
    qty_milli: z.number().int(),
    foc_qty_milli: z.number().int(),
    sales_paisa: paisa,
    costed_sales_paisa: paisa,
    cost_paisa: paisa,
    profit_paisa: paisa,
    uncosted_sales_paisa: paisa,
  }),
);

export const StaffReportSchema = z.array(
  z.object({
    staff_id: z.uuid(),
    name: z.string(),
    sales_count: z.number().int(),
    sales_paisa: paisa,
    discount_paisa: paisa,
    foc_value_paisa: paisa,
  }),
);

export const ExpenseReportSchema = z.object({
  from: date,
  to: date,
  lines: z.array(
    z.object({
      id: z.uuid(),
      business_date: date,
      category_id: z.uuid(),
      category_name: z.string().nullable(),
      category_name_ur: z.string().nullable(),
      category_i18n_key: z.string().nullable(),
      amount_paisa: paisa,
      paid_method_code: z.string(),
      note: z.string().nullable(),
      payee: z.string().nullable(),
      staff_id: z.uuid(),
      staff_name: z.string().nullable(),
      reverses_expense_id: z.uuid().nullable(),
      reversal_reason: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  /** All matching lines; `lines` holds at most 5000. */
  line_count: z.number().int(),
  total_paisa: paisa,
  by_category: z.array(AmountBy),
  by_method: z.array(AmountBy),
  previous: z.object({
    from: date,
    to: date,
    total_paisa: paisa,
    by_category: z.array(AmountBy),
  }),
});

export type ReportSummaryResponse = z.infer<typeof ReportSummarySchema>;
export type ProductReportResponse = z.infer<typeof ProductReportSchema>;
export type StaffReportResponse = z.infer<typeof StaffReportSchema>;
export type ExpenseReportResponse = z.infer<typeof ExpenseReportSchema>;

/** ?a=1&b=2 for the defined values. */
export function reportQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, v);
  const text = params.toString();
  return text ? `?${text}` : '';
}
