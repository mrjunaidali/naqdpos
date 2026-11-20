import { displayName } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';
import { methodName, usePaymentMethods } from '../settings/paymentMethods.ts';
import type { SaleBundle } from './saleData.ts';
import { useQtyText, useRs } from './saleFormat.ts';

/** Items, total (with rounding) and how it was paid. */
export function SaleDetail({ bundle, change }: { bundle: SaleBundle; change?: number }) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const qtyText = useQtyText();
  const methods = usePaymentMethods() ?? [];
  const { sale, lines, payments } = bundle;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-3 py-2">
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
            </span>
            <span dir="ltr">{rs(l.line_total_paisa)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1 rounded-2xl border border-border bg-surface p-3">
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
