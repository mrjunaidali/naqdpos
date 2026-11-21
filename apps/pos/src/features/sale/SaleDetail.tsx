import { displayName, priceForQty, sumPaisa } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema.ts';
import { useTranslation } from 'react-i18next';
import { methodName, usePaymentMethods } from '../settings/paymentMethods.ts';
import type { SaleBundle } from './saleData.ts';
import { useQtyText, useRs } from './saleFormat.ts';

/** Items (with line discounts and free items), bill discount, rounding, total and how it was paid. */
export function SaleDetail({ bundle, change }: { bundle: SaleBundle; change?: number }) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const qtyText = useQtyText();
  const methods = usePaymentMethods() ?? [];
  const { sale, lines, payments } = bundle;
  const approver = useLiveQuery(
    async () =>
      sale.discount_approved_by_staff_id
        ? db.staff.get(sale.discount_approved_by_staff_id)
        : undefined,
    [sale.discount_approved_by_staff_id],
  );
  const lineDiscounts = sumPaisa(lines.map((l) => l.discount_paisa));
  // A free line stores 0; its value at the sale price is qty × rate (integer maths in core).
  const focValue = sumPaisa(
    lines.filter((l) => l.is_foc).map((l) => priceForQty(l.qty_milli, l.unit_price_paisa)),
  );
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {lines.map((l) => (
          <li
            key={l.id}
            data-foc={l.is_foc || undefined}
            className={`flex items-center gap-2 px-3 py-2 ${
              l.is_foc ? 'm-1 rounded-xl border-2 border-dashed border-success' : ''
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {displayName({ name: l.name_snapshot, name_ur: l.name_ur_snapshot }, i18n.language)}
                {l.product_id === null && (
                  <span className="ms-2 rounded-full bg-bg px-2 text-xs text-muted">
                    {t('sale.custom')}
                  </span>
                )}
              </span>
              <span className="block text-sm text-muted">
                {l.by_amount
                  ? t('sale.lineByAmount', { qty: qtyText(l.qty_milli, l.unit_snapshot) })
                  : t('sale.lineQty', {
                      qty: qtyText(l.qty_milli, l.unit_snapshot),
                      rate: rs(l.unit_price_paisa),
                    })}
              </span>
              {l.discount_paisa > 0 && (
                <span className="block text-sm text-muted" dir="ltr">
                  {t('discount.lineAmount', { amount: rs(l.discount_paisa) })}
                </span>
              )}
            </span>
            {l.is_foc ? (
              <span className="font-bold text-success">{t('foc.label')}</span>
            ) : (
              <span dir="ltr">{rs(l.line_total_paisa)}</span>
            )}
          </li>
        ))}
      </ul>
      <dl className="space-y-1 rounded-2xl border border-border bg-surface p-3">
        {lineDiscounts > 0 && (
          <div className="flex justify-between text-sm text-muted">
            <dt>{t('discount.lines')}</dt>
            <dd dir="ltr">−{rs(lineDiscounts)}</dd>
          </div>
        )}
        {focValue > 0 && (
          <div className="flex justify-between text-sm text-muted">
            <dt>{t('foc.total')}</dt>
            <dd dir="ltr">{rs(focValue)}</dd>
          </div>
        )}
        {sale.discount_paisa > 0 && (
          <div className="flex justify-between">
            <dt>{t('discount.bill')}</dt>
            <dd dir="ltr">−{rs(sale.discount_paisa)}</dd>
          </div>
        )}
        {sale.discount_approved_by_staff_id && (
          <div className="text-sm text-muted">
            {t('discount.approvedBy', { name: approver?.name ?? '…' })}
          </div>
        )}
        {sale.rounding_paisa !== 0 && (
          <div className="flex justify-between text-sm text-muted">
            <dt>{t('done.rounding')}</dt>
            <dd dir="ltr">
              {sale.rounding_paisa > 0 ? '+' : '−'}
              {rs(Math.abs(sale.rounding_paisa))}
            </dd>
          </div>
        )}
        <div className="flex justify-between text-lg font-semibold">
          <dt>{t('sale.total')}</dt>
          <dd dir="ltr">{rs(sale.total_paisa)}</dd>
        </div>
        {payments.map((p) => (
          <div key={p.id} className="flex justify-between">
            <dt>
              {methodName(
                methods.find((m) => m.code === p.method_code) ?? {
                  code: p.method_code,
                  label: p.method_code,
                },
                t,
              )}
              {p.reference ? ` · ${p.reference}` : ''}
            </dt>
            <dd dir="ltr">{rs(p.amount_paisa)}</dd>
          </div>
        ))}
        {change !== undefined && change > 0 && (
          <div className="flex justify-between font-semibold">
            <dt>{t('done.change')}</dt>
            <dd dir="ltr">{rs(change)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
