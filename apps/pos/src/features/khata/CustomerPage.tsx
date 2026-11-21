import { can, formatPkMobile, khataBalance, runningBalance, type StaffRow } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { db } from '../../db/schema.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { ownerHereNow } from '../pin/ownerHereNow.ts';
import { OwnerPinDialog } from '../sale/OwnerPinDialog.tsx';
import { useRs } from '../sale/saleFormat.ts';
import { AdjustSheet } from './AdjustSheet.tsx';
import { updateCustomer, useCustomer, useKhataEntries } from './khataRepo.ts';
import { OpeningBalanceSheet } from './OpeningBalanceSheet.tsx';
import { ReceivePaymentSheet } from './ReceivePaymentSheet.tsx';

/**
 * A customer's khata (US041): balance, the full ledger with a running balance (sales link to the
 * sale), Receive payment, and the owner-only Adjust balance (owner PIN rules).
 */
export function CustomerPage() {
  const { customerId } = useParams();
  const { t } = useTranslation();
  const rs = useRs();
  const customer = useCustomer(customerId);
  const entries = useKhataEntries(customerId);
  const current = useCurrentStaff();
  const [open, setOpen] = useState<'receive' | 'adjust' | 'opening' | 'askOwner' | 'edit' | null>(
    null,
  );
  /** What the owner PIN is for: adjust or opening balance. */
  const [ownerFor, setOwnerFor] = useState<'adjust' | 'opening'>('adjust');
  const [owner, setOwner] = useState<StaffRow | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  if (customer === undefined || entries === undefined) return null;
  if (customer === null) return <p className="text-muted">{t('khata.notFound')}</p>;
  const staff = current?.valid ? current.staff : null;
  const balance = khataBalance(entries);
  const ledger = runningBalance(entries).reverse(); // newest first

  /** Owner actions (adjust, opening balance): the owner here, or their PIN. */
  async function startOwnerAction(action: 'adjust' | 'opening') {
    setOwnerFor(action);
    // Read now: a tap can come before the owner-here hook has loaded.
    const here = await ownerHereNow();
    if (here) {
      const row = await db.staff.get(here);
      if (row) {
        setOwner(row);
        setOpen(action);
      }
    } else setOpen('askOwner');
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{customer.name ?? formatPkMobile(customer.mobile)}</h1>
        <p className="text-muted" dir="ltr">
          {formatPkMobile(customer.mobile)}
        </p>
        {customer.address && <p className="text-muted">{customer.address}</p>}
      </div>
      <div className="rounded-2xl bg-hero p-4 text-hero-fg">
        <p className="text-sm text-hero-muted">{t('khata.balance')}</p>
        <p className="text-3xl font-bold" dir="ltr">
          {rs(balance)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {staff && can(staff.role, 'use_khata') && (
          <Button className="flex-1" onClick={() => setOpen('receive')}>
            {t('khata.receive')}
          </Button>
        )}
        {entries.length === 0 && (
          <Button
            className="flex-1"
            variant="secondary"
            onClick={() => void startOwnerAction('opening')}
          >
            {t('khata.opening')}
          </Button>
        )}
        <Button
          className="flex-1"
          variant="secondary"
          onClick={() => void startOwnerAction('adjust')}
        >
          {t('khata.adjust')}
        </Button>
        <Button
          className="flex-1"
          variant="secondary"
          onClick={() => {
            setName(customer.name ?? '');
            setAddress(customer.address ?? '');
            setOpen('edit');
          }}
        >
          {t('customers.edit')}
        </Button>
      </div>

      {open === 'edit' && (
        <form
          className="space-y-3 rounded-2xl border border-border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void updateCustomer(customer, { name, address }, staff?.id ?? null).then(() =>
              setOpen(null),
            );
          }}
        >
          <p className="text-sm text-muted">{t('customers.mobileFixed')}</p>
          <Field
            label={t('customers.nameOptional')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
          <Field
            label={t('customers.address')}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={200}
          />
          <Button type="submit">{t('customers.save')}</Button>
        </form>
      )}

      <h2 className="text-lg font-semibold">{t('khata.ledger')}</h2>
      {ledger.length === 0 ? (
        <p className="text-muted">{t('khata.noEntries')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {ledger.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {e.type === 'credit_sale' && e.sale_id ? (
                    <Link to={`/sales/${e.sale_id}`} className="underline">
                      {t('khata.type.credit_sale')}
                    </Link>
                  ) : (
                    t(`khata.type.${e.type}`)
                  )}
                </span>
                <span className="block text-sm text-muted" dir="ltr">
                  {e.business_date}
                </span>
                {e.note && <span className="block text-sm text-muted">{e.note}</span>}
              </span>
              <span className="text-end">
                <span
                  className={`block font-semibold ${e.amount_paisa < 0 ? 'text-success' : ''}`}
                  dir="ltr"
                >
                  {e.amount_paisa > 0 ? '+' : '−'}
                  {rs(Math.abs(e.amount_paisa))}
                </span>
                <span className="block text-xs text-muted" dir="ltr">
                  {t('khata.after', { amount: rs(e.balance_paisa) })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {open === 'receive' && staff && (
        <ReceivePaymentSheet customer={customer} staff={staff} onClose={() => setOpen(null)} />
      )}
      {open === 'askOwner' && (
        <OwnerPinDialog
          message={t('khata.ownerPin')}
          onClose={() => setOpen(null)}
          onSuccess={(ownerId) => {
            void db.staff.get(ownerId).then((row) => {
              if (row) {
                setOwner(row);
                setOpen(ownerFor);
              }
            });
          }}
        />
      )}
      {open === 'opening' && owner && (
        <OpeningBalanceSheet customer={customer} owner={owner} onClose={() => setOpen(null)} />
      )}
      {open === 'adjust' && owner && (
        <AdjustSheet customer={customer} owner={owner} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
