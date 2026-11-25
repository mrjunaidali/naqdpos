import {
  addNote,
  applyPayment,
  computeBill,
  EMPTY_TENDER,
  exactTender,
  formatPkMobile,
  giveAway,
  parseRupees,
  remainingDue,
  TENDER_NOTES,
  tenderSummary,
  typedTender,
  type Discount,
  type PaymentDraft,
  type Tender,
} from '@naqdpos/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { Alert, Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/icons.tsx';
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
 *
 * Fits one phone screen (375×667 first): total, tendered and change/remaining at the top, the
 * method chips, then note buttons (cash) or the keypad and Confirm at the bottom. Only the middle
 * (split payments, customer, bill details) scrolls when it needs more room.
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
  /** Keypad text; mirrors `tender` so either can be used. */
  const [amount, setAmount] = useState('');
  const [tender, setTenderState] = useState<Tender>(EMPTY_TENDER);
  /** Cash: keypad instead of note buttons. Other methods always use the keypad. */
  const [typing, setTyping] = useState(false);
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
  const isCash = method === 'cash';
  const isKhata = method === KHATA;
  const typed = tender.paisa;
  const { change_paisa: change, short_paisa: short } = tenderSummary(tender, due);
  const covers = typed > 0 && (isCash ? typed >= due : typed === due);

  function setTender(next: Tender) {
    setTenderState(next);
    setAmount(next.paisa > 0 ? rupeesInput(next.paisa) : '');
  }
  function typeAmount(text: string) {
    setAmount(text);
    setTenderState(typedTender(parseRupees(text, false).paisa));
  }

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
    setTender(EMPTY_TENDER);
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
    setTender(code === 'cash' ? EMPTY_TENDER : typedTender(due));
  };

  const chipClass = (on: boolean) =>
    `min-h-11 shrink-0 rounded-full border px-4 font-medium ${
      on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-text'
    }`;
  const padKey =
    'relative min-h-11 rounded-xl border border-border font-semibold text-text disabled:opacity-40';
  const keypad = !isCash || typing;
  const showChange = isCash && typed >= due;

  return (
    // One screen: the page height minus the fixed header, the safe areas and main's padding.
    <section className="mx-auto flex h-[calc(100dvh-var(--top-inset)-var(--bottom-inset)-2rem)] min-h-[30rem] max-w-md flex-col gap-2 md:max-w-4xl md:flex-row md:gap-6">
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            aria-label={t('pay.backToCart')}
            onClick={() => void navigate('/sale')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-surface disabled:opacity-50"
          >
            <Icon name="back" className="size-5 rtl:-scale-x-100" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{t('pay.title')}</h1>
          <button
            type="button"
            disabled={settling || busy}
            onClick={() => setEditingDiscount(true)}
            className="min-h-11 shrink-0 rounded-md border border-border bg-surface px-3 text-sm font-medium disabled:opacity-50"
          >
            {bill.discount_paisa > 0
              ? t('discount.lineAmount', { amount: rs(bill.discount_paisa) })
              : t('discount.button')}
          </button>
        </div>

        <div className="shrink-0 rounded-2xl bg-hero p-3 text-hero-fg">
          <dl className="flex items-start justify-between gap-2" data-figure="total">
            <div className="min-w-0">
              <dt className="text-sm text-hero-muted">{t('pay.total')}</dt>
              {bill.rounding_paisa !== 0 && (
                <p className="text-xs text-hero-muted">
                  {t('pay.rounding', {
                    sign: bill.rounding_paisa > 0 ? '+' : '−',
                    amount: rs(Math.abs(bill.rounding_paisa)),
                    subtotal: rs(bill.subtotal_paisa - bill.discount_paisa),
                  })}
                </p>
              )}
              {settling && (
                <p className="text-sm font-semibold">{t('pay.remaining', { amount: rs(due) })}</p>
              )}
            </div>
            <dd className="shrink-0 text-3xl font-bold" dir="ltr">
              {rs(bill.total_paisa)}
            </dd>
          </dl>
          <dl className="mt-2 grid grid-cols-2 gap-2 border-t border-hero-muted/40 pt-2">
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1" aria-live="polite" data-figure="tendered">
                <dt className="truncate text-xs text-hero-muted">
                  {isCash ? t('pay.tendered') : t('pay.amount')}
                </dt>
                <dd className="truncate text-xl font-semibold" dir="ltr">
                  {rs(typed)}
                </dd>
              </div>
              {isCash && (
                <button
                  type="button"
                  aria-label={t('pay.typeAmount')}
                  aria-pressed={typing}
                  onClick={() => setTyping(!typing)}
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md ${
                    typing ? 'bg-surface text-text' : 'text-hero-fg'
                  }`}
                >
                  <Icon name="keypad" />
                </button>
              )}
            </div>
            <div className="min-w-0" aria-live="polite" data-figure="change">
              <dt className="truncate text-xs text-hero-muted">
                {showChange ? t('pay.changeLabel') : t('pay.left')}
              </dt>
              <dd className="truncate text-xl font-semibold" dir="ltr">
                {rs(showChange ? change : short)}
              </dd>
            </div>
          </dl>
        </div>

        <div
          role="group"
          aria-label={t('pay.method')}
          className="-mx-4 flex shrink-0 gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0"
        >
          {chips.map((m) => (
            <button
              key={m.code}
              type="button"
              aria-pressed={method === m.code}
              onClick={() => chooseMethod(m.code)}
              className={chipClass(method === m.code)}
            >
              {methodName(m, t)}
            </button>
          ))}
          {/* Always offered (US080): without a customer it first opens the customer picker. */}
          <button
            type="button"
            aria-pressed={isKhata}
            onClick={() => (customerId ? chooseMethod(KHATA) : setPickingCustomer(true))}
            className={chipClass(isKhata)}
          >
            {t('pay.khata')}
          </button>
        </div>

        {/* The only part that scrolls: errors, the customer, split payments, bill details. */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" data-scroll="pay-middle">
          {error && <Alert>{error}</Alert>}
          {customer && (
            <p className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface ps-3 text-sm">
              <span className="min-w-0 truncate">{t('pay.customer', { name: customerLabel })}</span>
              <button
                type="button"
                className="min-h-11 min-w-11 shrink-0 rounded-md"
                aria-label={t('customers.remove')}
                onClick={removeCustomer}
              >
                ✕
              </button>
            </p>
          )}
          {settling && (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
              {khata > 0 && (
                <li className="flex items-center gap-2 ps-3">
                  <span className="min-w-0 flex-1 truncate">
                    {t('pay.khataRow', { name: customerLabel })}
                  </span>
                  <span dir="ltr">{rs(khata)}</span>
                  <button
                    type="button"
                    className="min-h-11 min-w-11 rounded-md"
                    aria-label={t('pay.removeKhata')}
                    onClick={() => setKhata(0)}
                  >
                    ✕
                  </button>
                </li>
              )}
              {payments.map((p, i) => (
                <li key={i} className="flex items-center gap-2 ps-3">
                  <span className="min-w-0 flex-1 truncate">
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
                    className="min-h-11 min-w-11 rounded-md"
                    aria-label={t('pay.removePayment')}
                    onClick={() => setPayments(payments.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(bill.line_discount_paisa > 0 || bill.foc_value_paisa > 0 || settling) && (
            <dl className="space-y-0.5 px-1 text-xs text-muted">
              {bill.line_discount_paisa > 0 && (
                <div className="flex justify-between">
                  <dt>{t('discount.lines')}</dt>
                  <dd dir="ltr">−{rs(bill.line_discount_paisa)}</dd>
                </div>
              )}
              {bill.foc_value_paisa > 0 && (
                <div className="flex justify-between">
                  <dt>{t('foc.total')}</dt>
                  <dd dir="ltr">{rs(bill.foc_value_paisa)}</dd>
                </div>
              )}
              {settling && <p>{t('discount.lockedByPayments')}</p>}
            </dl>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 md:w-96 md:justify-start">
        {!isCash && !isKhata && (
          <input
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
            aria-label={t('pay.reference')}
            placeholder={t('pay.reference')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={64}
            autoComplete="off"
            dir="ltr"
          />
        )}
        {isCash && (
          <div className="grid grid-cols-4 gap-1.5" dir="ltr">
            {!keypad &&
              TENDER_NOTES.map((note) => {
                const count = tender.notes[note] ?? 0;
                return (
                  <button
                    key={note}
                    type="button"
                    aria-label={t('pay.addNote', { amount: rs(note) })}
                    onClick={() => setTender(addNote(tender, note))}
                    className={`${padKey} ${note < 1000 ? 'bg-bg' : 'bg-surface'} text-base`}
                  >
                    {rupeesInput(note)}
                    {count > 0 && (
                      <span className="absolute -end-1 -top-1.5 min-w-6 rounded-full bg-primary px-1 text-xs leading-5 text-primary-fg">
                        ×{count}
                      </span>
                    )}
                  </button>
                );
              })}
            <button
              type="button"
              onClick={() => setTender(exactTender(due))}
              className={`${padKey} bg-bg text-sm ${typing ? 'col-span-2' : ''}`}
            >
              {t('pay.exact')}
            </button>
            <button
              type="button"
              disabled={typed === 0}
              onClick={() => setTender(EMPTY_TENDER)}
              className={`${padKey} bg-bg text-sm ${typing ? 'col-span-2' : ''}`}
            >
              {t('pay.clear')}
            </button>
          </div>
        )}
        {keypad && <NumberPad value={amount} onChange={typeAmount} decimals={2} compact />}
        <Button disabled={busy || typed === 0} onClick={() => addPayment(typed)}>
          {busy ? t('common.wait') : covers ? t('pay.complete') : t('pay.addPayment')}
        </Button>
      </div>
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
