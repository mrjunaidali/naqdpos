import {
  applyPayment,
  changeDue,
  computeBill,
  formatPkMobile,
  giveAway,
  parseRupees,
  remainingDue,
  type Discount,
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
import { CustomerPicker } from '../khata/CustomerPicker.tsx';
import { useCustomer } from '../khata/khataRepo.ts';
import { completeSale, SaleNotCompleted } from './completeSale.ts';
import { currentSeller, ownerApprovalNeeded } from './discountLimit.ts';
import { DiscountSheet } from './DiscountSheet.tsx';
import { OwnerPinDialog } from './OwnerPinDialog.tsx';
import { NumberPad } from './NumberPad.tsx';
import { useRs } from './saleFormat.ts';

/** The Khata chip's pseudo method code (never stored: khata is not a payment). */
const KHATA = '__khata';

const QUICK_CASH = [10_000, 50_000, 100_000, 500_000] as const; // Rs 100, 500, 1000, 5000

const ERRORS: Record<string, string> = {
  zero: 'pay.errors.zero',
  too_much: 'pay.errors.tooMuch',
  nothing_due: 'pay.errors.nothingDue',
};

/**
 * Pay (US034, US035): the rounded total, method chips, cash with change, split payments with an
 * optional reference. Completing writes the sale on the device; nothing waits for the network.
 * The bill discount (US032) can change only while no payment is added; a cashier over the
 * discount limit needs the owner's PIN (when applying the discount, and again before completing
 * if the bill changed).
 */
export function PayPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rs = useRs();
  const lines = useCartStore((s) => s.lines);
  const billDiscount = useCartStore((s) => s.billDiscount);
  const setBillDiscount = useCartStore((s) => s.setBillDiscount);
  const setApproval = useCartStore((s) => s.setApproval);
  const [editingDiscount, setEditingDiscount] = useState(false);
  type Ask =
    | { kind: 'discount'; discount: Discount }
    | { kind: 'finish'; all: PaymentDraft[]; change: number; khata: number };
  const [askOwner, setAskOwner] = useState<Ask | null>(null);
  const ready = useCartStore((s) => s.ready);
  const hydrate = useCartStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const methods = usePaymentMethods();
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  /** The part on the customer's khata (US039): not a payments row. */
  const [khataTyped, setKhata] = useState(0);
  const customerId = useCartStore((s) => s.customerId);
  const customer = useCustomer(customerId);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  // No customer, no khata part (also when the customer is removed on the sale screen).
  const khata = customerId ? khataTyped : 0;
  function removeCustomer() {
    setCustomer(null);
    setKhata(0);
    if (method === KHATA) setMethod('cash');
  }
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (ready && lines.length === 0 && !busy) return <Navigate to="/sale" replace />;

  const bill = computeBill(lines, billDiscount);
  const due = remainingDue(bill.total_paisa, payments) - khata;
  const settling = payments.length > 0 || khata > 0;
  // Cash is offered even before the shop's methods have been pulled (every shop has it).
  const active = (methods ?? []).filter((m) => m.active);
  const chips = active.some((m) => m.code === 'cash')
    ? active
    : [{ id: 'cash', code: 'cash', label: 'Cash' }, ...active];
  const customerLabel = customer ? (customer.name ?? formatPkMobile(customer.mobile)) : '';
  const typed = parseRupees(amount, false).paisa;
  const isCash = method === 'cash';
  const isKhata = method === KHATA;
  const change = isCash && typed ? changeDue(typed, due) : 0;

  async function finish(all: PaymentDraft[], changePaisa: number, khataPaisa: number) {
    const cart = useCartStore.getState();
    const seller = await currentSeller();
    if (ownerApprovalNeeded(cart.lines, cart.billDiscount, cart.approval, seller).needed) {
      setAskOwner({ kind: 'finish', all, change: changePaisa, khata: khataPaisa });
      return;
    }
    setBusy(true);
    try {
      const rows = await completeSale(all, { khataPaisa });
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
    if (isKhata) {
      // On khata: up to what is left; the rest is still paid by money.
      if (paisa <= 0) return setError(t('pay.errors.zero'));
      if (paisa > due) return setError(t('pay.errors.tooMuch'));
      setError(undefined);
      const next = khata + paisa;
      if (paisa === due) {
        void finish(payments, 0, next);
        return;
      }
      setKhata(next);
      setAmount('');
      chooseMethod('cash');
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
    if (remainingDue(bill.total_paisa, all) - khata === 0) {
      void finish(all, result.change_paisa, khata);
      return;
    }
    setPayments(all);
    setAmount('');
    setReference('');
  }

  async function applyDiscount(discount: Discount) {
    const cart = useCartStore.getState();
    setEditingDiscount(false);
    const seller = await currentSeller();
    if (ownerApprovalNeeded(cart.lines, discount, cart.approval, seller).needed) {
      setAskOwner({ kind: 'discount', discount });
      return;
    }
    setBillDiscount(discount);
  }

  function ownerApproved(ownerId: string) {
    const ask = askOwner;
    setAskOwner(null);
    if (!ask) return;
    const cart = useCartStore.getState();
    const discount = ask.kind === 'discount' ? ask.discount : cart.billDiscount;
    const { give_away_paisa } = giveAway(cart.lines, discount);
    setApproval({ staffId: ownerId, give_away_paisa });
    if (ask.kind === 'discount') setBillDiscount(ask.discount);
    else void finish(ask.all, ask.change, ask.khata);
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
              subtotal: rs(bill.subtotal_paisa - bill.discount_paisa),
            })}
          </p>
        )}
        {settling && (
          <p className="mt-2 font-semibold">{t('pay.remaining', { amount: rs(due) })}</p>
        )}
      </div>

      <dl className="space-y-1 rounded-2xl border border-border bg-surface p-3">
        {bill.line_discount_paisa > 0 && (
          <div className="flex justify-between text-sm text-muted">
            <dt>{t('discount.lines')}</dt>
            <dd dir="ltr">−{rs(bill.line_discount_paisa)}</dd>
          </div>
        )}
        {bill.foc_value_paisa > 0 && (
          <div className="flex justify-between text-sm text-muted">
            <dt>{t('foc.total')}</dt>
            <dd dir="ltr">{rs(bill.foc_value_paisa)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <dt>
            {billDiscount?.kind === 'pct'
              ? t('discount.billPct', { pct: billDiscount.value })
              : t('discount.bill')}
          </dt>
          <dd className="flex items-center gap-2">
            {bill.discount_paisa > 0 && <span dir="ltr">−{rs(bill.discount_paisa)}</span>}
            <button
              type="button"
              disabled={settling || busy}
              onClick={() => setEditingDiscount(true)}
              className="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50"
            >
              {billDiscount ? t('discount.change') : t('discount.button')}
            </button>
          </dd>
        </div>
        {settling && <p className="text-xs text-muted">{t('discount.lockedByPayments')}</p>}
      </dl>

      {settling && (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {khata > 0 && (
            <li className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1">{t('pay.khataRow', { name: customerLabel })}</span>
              <span dir="ltr">{rs(khata)}</span>
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-md border border-border"
                aria-label={t('pay.removeKhata')}
                onClick={() => setKhata(0)}
              >
                ✕
              </button>
            </li>
          )}
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
        {/* Always offered (US080): without a customer it first opens the customer picker. */}
        <button
          type="button"
          aria-pressed={isKhata}
          onClick={() => (customerId ? chooseMethod(KHATA) : setPickingCustomer(true))}
          className={`min-h-11 rounded-full border px-4 font-medium ${
            isKhata
              ? 'border-primary bg-primary text-primary-fg'
              : 'border-border bg-surface text-text'
          }`}
        >
          {t('pay.khata')}
        </button>
      </div>
      {customer && (
        <p className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3">
          <span>{t('pay.customer', { name: customerLabel })}</span>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-md"
            aria-label={t('customers.remove')}
            onClick={removeCustomer}
          >
            ✕
          </button>
        </p>
      )}
      {pickingCustomer && (
        <CustomerPicker
          onClose={() => setPickingCustomer(false)}
          onPick={(c) => {
            setCustomer(c.id);
            setPickingCustomer(false);
            chooseMethod(KHATA);
          }}
        />
      )}

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
      {!isCash && !isKhata && (
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
      {editingDiscount && (
        <DiscountSheet
          title={t('discount.billTitle')}
          basePaisa={bill.subtotal_paisa}
          initial={billDiscount}
          onApply={(discount) => void applyDiscount(discount)}
          onRemove={() => {
            setBillDiscount(null);
            setEditingDiscount(false);
          }}
          onClose={() => setEditingDiscount(false)}
        />
      )}
      {askOwner && (
        <OwnerPinDialog
          message={t('discount.ownerNeeded')}
          onClose={() => setAskOwner(null)}
          onSuccess={ownerApproved}
        />
      )}
    </section>
  );
}
