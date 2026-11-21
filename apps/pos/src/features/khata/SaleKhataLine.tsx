import { formatPkMobile, khataBalance } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useRs } from '../sale/saleFormat.ts';
import { useCustomer, useKhataEntries } from './khataRepo.ts';

/** On the success screen and sale view: the customer, what went on khata, the new balance. */
export function SaleKhataLine({ saleId, customerId }: { saleId: string; customerId: string }) {
  const { t } = useTranslation();
  const rs = useRs();
  const customer = useCustomer(customerId);
  const entries = useKhataEntries(customerId);
  if (!customer || !entries) return null;
  const onKhata = entries.find((e) => e.type === 'credit_sale' && e.sale_id === saleId);
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <Link to={`/khata/${customer.id}`} className="font-semibold underline">
        {customer.name ?? formatPkMobile(customer.mobile)}
      </Link>
      {onKhata && <p>{t('done.onKhata', { amount: rs(onKhata.amount_paisa) })}</p>}
      <p className="font-semibold">{t('done.newBalance', { amount: rs(khataBalance(entries)) })}</p>
    </div>
  );
}
