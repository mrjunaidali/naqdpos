import {
  khataReceiptText,
  parseRupees,
  waLink,
  type CustomerRow,
  type StaffRow,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useRs } from '../sale/saleFormat.ts';
import { methodName, usePaymentMethods } from '../settings/paymentMethods.ts';
import { KhataNotSaved, receiveKhataPayment } from './khataRepo.ts';

/**
 * Receive a khata payment (US040): amount, method, optional reference. Saves the payment and its
 * khata entry together (offline), then offers a WhatsApp receipt in the app language.
 */
export function ReceivePaymentSheet(props: {
  customer: CustomerRow;
  staff: StaffRow;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const methods = usePaymentMethods();
  const shopName = useLiveQuery(async () => {
    const device = await getStoredDevice();
    return (device ? (await db.shops.get(device.shop_id))?.name : undefined) ?? '';
  });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ amount: number; balance: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const active = (methods ?? []).filter((m) => m.active);
  const chips = active.some((m) => m.code === 'cash')
    ? active
    : [{ id: 'cash', code: 'cash', label: 'Cash' }, ...active];

  async function save() {
    const parsed = parseRupees(amount, true);
    if (parsed.error || !parsed.paisa) {
      setError(t('khata.errors.amount'));
      return;
    }
    setBusy(true);
    try {
      const result = await receiveKhataPayment(
        props.customer,
        parsed.paisa,
        method,
        method === 'cash' ? null : reference,
        props.staff,
      );
      setDone({ amount: parsed.paisa, balance: result.balance_paisa });
    } catch (e) {
      setError(e instanceof KhataNotSaved ? t('khata.errors.amount') : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const text = khataReceiptText(i18n.language, done.amount, done.balance, shopName ?? '');
    return (
      <Sheet title={t('khata.receivedTitle')} onClose={props.onClose}>
        <p className="text-lg">{t('khata.received', { amount: rs(done.amount) })}</p>
        <p className="text-lg font-semibold">
          {t('done.newBalance', { amount: rs(done.balance) })}
        </p>
        <a
          href={waLink(props.customer.mobile, text)}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-12 items-center justify-center rounded-md bg-primary px-4 font-semibold text-primary-fg"
        >
          {t('khata.shareWhatsapp')}
        </a>
        <Button variant="secondary" onClick={props.onClose}>
          {t('common.close')}
        </Button>
      </Sheet>
    );
  }

  return (
    <Sheet title={t('khata.receiveTitle')} onClose={props.onClose}>
      <Field
        label={t('khata.amount')}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setError(undefined);
        }}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        error={error}
      />
      <div role="group" aria-label={t('pay.method')} className="flex flex-wrap gap-2">
        {chips.map((m) => (
          <button
            key={m.code}
            type="button"
            aria-pressed={method === m.code}
            onClick={() => setMethod(m.code)}
            className={`min-h-11 rounded-full border px-4 font-medium ${
              method === m.code
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface text-text'
            }`}
          >
            {methodName(m, t)}
          </button>
        ))}
      </div>
      {method !== 'cash' && (
        <Field
          label={t('pay.reference')}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={64}
          autoComplete="off"
          dir="ltr"
        />
      )}
      <Button disabled={busy || !amount} onClick={() => void save()}>
        {busy ? t('common.wait') : t('khata.saveReceipt')}
      </Button>
    </Sheet>
  );
}
