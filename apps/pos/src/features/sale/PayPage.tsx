import {
  applyPayment,
  cartTotals,
  changeDue,
  parseRupees,
  remainingDue,
  roundBill,
  type PaymentDraft,
} from '@naqdpos/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { rupeesInput } from '../catalogue/catalogueData.ts';
import { methodName, usePaymentMethods } from '../settings/paymentMethods.ts';
import { useCartStore } from './cartStore.ts';
import { completeSale, SaleNotCompleted } from './completeSale.ts';
import { NumberPad } from './NumberPad.tsx';
import { useRs } from './saleFormat.ts';

const QUICK_CASH = [10_000, 50_000, 100_000, 500_000] as const; // Rs 100, 500, 1000, 5000

const ERRORS: Record<string, string> = {
  zero: 'pay.errors.zero',
  too_much: 'pay.errors.tooMuch',
  nothing_due: 'pay.errors.nothingDue',
};

/**
 * Pay (US034, US035): the rounded total, method chips, cash with change, split payments with an
 * optional reference. Completing writes the sale on the device; nothing waits for the network.
 */
export function PayPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rs = useRs();
  const lines = useCartStore((s) => s.lines);
  const ready = useCartStore((s) => s.ready);
  const hydrate = useCartStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const methods = usePaymentMethods();
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (ready && lines.length === 0 && !busy) return <Navigate to="/sale" replace />;

  const bill = roundBill(cartTotals(lines).subtotal_paisa);
  const due = remainingDue(bill.total_paisa, payments);
  // Cash is offered even before the shop's methods have been pulled (every shop has it).
  const active = (methods ?? []).filter((m) => m.active);
  const chips = active.some((m) => m.code === 'cash')
    ? active
    : [{ id: 'cash', code: 'cash', label: 'Cash' }, ...active];
  const typed = parseRupees(amount, false).paisa;
  const isCash = method === 'cash';
  const change = isCash && typed ? changeDue(typed, due) : 0;

  async function finish(all: PaymentDraft[], changePaisa: number) {
    setBusy(true);
    try {
      const rows = await completeSale(all);
      void navigate(`/sale/done/${rows.sale.id}`, {
        replace: true,
        state: { change: changePaisa },
      });
    } catch (e) {
      setError(t(e instanceof SaleNotCompleted ? `pay.errors.${e.reason}` : 'errors.generic'));
      setBusy(false);
    }
  }

  function addPayment(paisa: number | null) {
    if (paisa === null) {
      setError(t('pay.errors.zero'));
      return;
    }
    const result = applyPayment(due, method, paisa, isCash ? null : reference.trim() || null);
    if ('error' in result) {
      setError(t(ERRORS[result.error] ?? 'errors.generic'));
      return;
    }
    setError(undefined);
    // The tendered amount is not stored: the row records only what was applied.
    const row: PaymentDraft = {
      method_code: result.payment.method_code,
      amount_paisa: result.payment.amount_paisa,
      reference: result.payment.reference,
    };
    const all = [...payments, row];
    if (remainingDue(bill.total_paisa, all) === 0) {
      void finish(all, result.change_paisa);
      return;
    }
    setPayments(all);
    setAmount('');
    setReference('');
  }

  const chooseMethod = (code: string) => {
    setMethod(code);
    setError(undefined);
    // Wallets and bank usually pay the rest exactly.
    setAmount(code === 'cash' ? '' : rupeesInput(due));
  };

  return (
    <section className="mx-auto max-w-md space-y-4 pb-8">
      <h1 className="text-2xl font-bold">{t('pay.title')}</h1>
      <div className="rounded-2xl bg-hero p-4 text-hero-fg">
        <p className="text-sm text-hero-muted">{t('pay.total')}</p>
        <p className="text-4xl font-bold" dir="ltr">
          {rs(bill.total_paisa)}
        </p>
        {bill.rounding_paisa !== 0 && (
          <p className="text-sm text-hero-muted">
            {t('pay.rounding', {
              sign: bill.rounding_paisa > 0 ? '+' : '−',
              amount: rs(Math.abs(bill.rounding_paisa)),
              subtotal: rs(bill.subtotal_paisa),
            })}
          </p>
        )}
        {payments.length > 0 && (
          <p className="mt-2 font-semibold">{t('pay.remaining', { amount: rs(due) })}</p>
        )}
      </div>

      {payments.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {payments.map((p, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1">
                {methodName(
                  chips.find((m) => m.code === p.method_code) ?? {
                    code: p.method_code,
                    label: p.method_code,
                  },
                  t,
                )}
                {p.reference ? ` · ${p.reference}` : ''}
              </span>
              <span dir="ltr">{rs(p.amount_paisa)}</span>
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-md border border-border"
                aria-label={t('pay.removePayment')}
                onClick={() => setPayments(payments.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div role="group" aria-label={t('pay.method')} className="flex flex-wrap gap-2">
        {chips.map((m) => (
          <button
            key={m.code}
            type="button"
            aria-pressed={method === m.code}
            onClick={() => chooseMethod(m.code)}
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

      {error && <Alert>{error}</Alert>}

      {isCash && (
        <div className="grid grid-cols-5 gap-2">
          <button
            type="button"
            onClick={() => setAmount(rupeesInput(due))}
            className="min-h-12 rounded-xl border border-border bg-bg text-sm font-semibold"
          >
            {t('pay.exact')}
          </button>
          {QUICK_CASH.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount(rupeesInput(q))}
              className="min-h-12 rounded-xl border border-border bg-bg text-sm font-semibold"
              dir="ltr"
            >
              {rs(q)}
            </button>
          ))}
        </div>
      )}

      <p
        className="min-h-12 rounded-xl border border-border px-4 py-2 text-end text-2xl"
        dir="ltr"
        aria-label={isCash ? t('pay.tendered') : t('pay.amount')}
        aria-live="polite"
      >
        {t('sale.rs', { amount: amount || '0' })}
      </p>
      {isCash && (
        <p className="text-lg font-semibold" aria-live="polite">
          {t('pay.change', { amount: rs(change) })}
        </p>
      )}
      <NumberPad value={amount} onChange={setAmount} decimals={2} />
      {!isCash && (
        <Field
          label={t('pay.reference')}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={64}
          autoComplete="off"
          dir="ltr"
        />
      )}
      <Button disabled={busy || !amount} onClick={() => addPayment(typed)}>
        {busy
          ? t('common.wait')
          : typed !== null && (isCash ? typed >= due : typed === due)
            ? t('pay.complete')
            : t('pay.addPayment')}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => void navigate('/sale')}>
        {t('pay.backToCart')}
      </Button>
    </section>
  );
}
