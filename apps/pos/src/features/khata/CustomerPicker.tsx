import {
  formatPkMobile,
  khataBalance,
  normalizePkMobile,
  parseRupees,
  type CustomerRow,
} from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useRs } from '../sale/saleFormat.ts';
import { matchCustomers } from './customerSearch.ts';
import { db } from '../../db/schema.ts';
import { ownerHereNow } from '../pin/ownerHereNow.ts';
import { OwnerPinDialog } from '../sale/OwnerPinDialog.tsx';
import { findOrAddCustomer, recordOpeningBalance, useBalances, useCustomers } from './khataRepo.ts';

const MAX_SHOWN = 20;

/**
 * Pick or add a customer (US038, US080): search, or add by mobile (name and address optional).
 * An existing mobile picks that customer. An opening balance from the paper khata is owner-only
 * (owner PIN unless an owner is here) and only for a customer with no entries yet. Offline.
 */
export function CustomerPicker(props: {
  onPick: (customer: CustomerRow) => void;
  onClose: () => void;
  /** Open on the add form (Khata → Add customer). */
  startAdding?: boolean;
}) {
  const { t } = useTranslation();
  const rs = useRs();
  const customers = useCustomers() ?? [];
  const balances = useBalances();
  const current = useCurrentStaff();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(props.startAdding ?? false);
  const [address, setAddress] = useState('');
  const [opening, setOpening] = useState('');
  const [openingError, setOpeningError] = useState<string>();
  const [askOwner, setAskOwner] = useState(false);
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState(false);

  const shown = matchCustomers(customers, query).slice(0, MAX_SHOWN);

  async function save(ownerId: string | null) {
    const openingPaisa = opening.trim() ? parseRupees(opening, false).paisa : null;
    try {
      const customer = await findOrAddCustomer(mobile, name, current?.staff.id ?? null, address);
      if (openingPaisa && ownerId) {
        const owner = await db.staff.get(ownerId);
        // A customer who already has entries keeps them: no second opening balance.
        if (owner) await recordOpeningBalance(customer, openingPaisa, owner).catch(() => undefined);
      }
      props.onPick(customer);
    } catch {
      setFailed(true);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!normalizePkMobile(mobile)) {
      setError(t('customers.errors.mobile'));
      return;
    }
    if (opening.trim()) {
      const parsed = parseRupees(opening, false);
      if (parsed.error || !parsed.paisa) {
        setOpeningError(t('khata.errors.amount'));
        return;
      }
      // Opening balance is owner-only: the owner here, or their PIN.
      const owner = await ownerHereNow();
      if (!owner) {
        setAskOwner(true);
        return;
      }
      return save(owner);
    }
    return save(null);
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
          <Field
            label={t('customers.address')}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={200}
            autoComplete="off"
          />
          <Field
            label={t('customers.openingBalance')}
            hint={t('customers.openingBalanceHint')}
            value={opening}
            onChange={(e) => {
              setOpening(e.target.value);
              setOpeningError(undefined);
            }}
            error={openingError}
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
          />
          <Button type="submit">{t('customers.save')}</Button>
          <Button variant="secondary" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      {askOwner && (
        <OwnerPinDialog
          message={t('customers.ownerForOpening')}
          onClose={() => setAskOwner(false)}
          onSuccess={(ownerId) => {
            setAskOwner(false);
            void save(ownerId);
          }}
        />
      )}
    </Sheet>
  );
}
