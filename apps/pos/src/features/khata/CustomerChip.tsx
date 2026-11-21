import { formatPkMobile, khataBalance } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCartStore } from '../sale/cartStore.ts';
import { useRs } from '../sale/saleFormat.ts';
import { CustomerPicker } from './CustomerPicker.tsx';
import { useCustomer, useKhataEntries } from './khataRepo.ts';

/** The sale screen's customer chip (US038): pick or add; shows the balance; remove. */
export function CustomerChip({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const rs = useRs();
  const customerId = useCartStore((s) => s.customerId);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const customer = useCustomer(customerId);
  const entries = useKhataEntries(customerId);
  const [picking, setPicking] = useState(false);
  const balance = khataBalance(entries ?? []);

  return (
    <>
      {customer ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-primary bg-surface ps-3 text-sm">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="min-h-11 text-start"
            title={t('customers.change')}
          >
            <span className="font-semibold">
              {customer.name ?? formatPkMobile(customer.mobile)}
            </span>
            {balance !== 0 && (
              <span className="ms-2 text-muted">
                {t('customers.balanceShort', { amount: rs(balance) })}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setCustomer(null)}
            aria-label={t('customers.remove')}
            className="min-h-11 min-w-11 rounded-full"
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPicking(true)}
          className="min-h-11 rounded-full border border-border px-3 text-sm text-text disabled:opacity-60"
        >
          {t('sale.customer')}
        </button>
      )}
      {picking && (
        <CustomerPicker
          onClose={() => setPicking(false)}
          onPick={(c) => {
            setCustomer(c.id);
            setPicking(false);
          }}
        />
      )}
    </>
  );
}
