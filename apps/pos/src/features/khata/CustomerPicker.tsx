import { formatPkMobile, khataBalance, normalizePkMobile, type CustomerRow } from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useRs } from '../sale/saleFormat.ts';
import { matchCustomers } from './customerSearch.ts';
import { findOrAddCustomer, useBalances, useCustomers } from './khataRepo.ts';

const MAX_SHOWN = 20;

/** Attach a customer to the sale (US038): search, or add by mobile (name optional). Offline. */
export function CustomerPicker(props: {
  onPick: (customer: CustomerRow) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rs = useRs();
  const customers = useCustomers() ?? [];
  const balances = useBalances();
  const current = useCurrentStaff();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState(false);

  const shown = matchCustomers(customers, query).slice(0, MAX_SHOWN);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!normalizePkMobile(mobile)) {
      setError(t('customers.errors.mobile'));
      return;
    }
    try {
      const customer = await findOrAddCustomer(mobile, name, current?.staff.id ?? null);
      props.onPick(customer);
    } catch {
      setFailed(true);
    }
  }

  return (
    <Sheet title={t('customers.pickTitle')} onClose={props.onClose}>
      {!adding ? (
        <>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('customers.searchPlaceholder')}
            aria-label={t('customers.search')}
            className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-lg"
          />
          {shown.length === 0 ? (
            <p className="text-muted">{t('customers.noMatch')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {shown.map((c) => {
                const balance = khataBalance(balances?.get(c.id) ?? []);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => props.onPick(c)}
                      className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-start"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {c.name ?? formatPkMobile(c.mobile)}
                        </span>
                        {c.name && (
                          <span className="block text-sm text-muted" dir="ltr">
                            {formatPkMobile(c.mobile)}
                          </span>
                        )}
                      </span>
                      {balance !== 0 && (
                        <span className="text-sm font-semibold" dir="ltr">
                          {rs(balance)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              // A typed mobile carries over to the form.
              if (normalizePkMobile(query)) setMobile(query);
              setAdding(true);
            }}
          >
            {t('customers.addNew')}
          </Button>
        </>
      ) : (
        <form className="space-y-3" onSubmit={(e) => void add(e)} noValidate>
          {failed && <Alert>{t('errors.generic')}</Alert>}
          <Field
            label={t('customers.mobile')}
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value);
              setError(undefined);
            }}
            error={error}
            inputMode="tel"
            dir="ltr"
            autoComplete="off"
            required
          />
          <Field
            label={t('customers.nameOptional')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="off"
          />
          <Button type="submit">{t('customers.save')}</Button>
          <Button variant="secondary" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
