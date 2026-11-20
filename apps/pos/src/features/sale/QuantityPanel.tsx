import {
  makeAmountLine,
  makeLine,
  parseQtyInput,
  parseRupees,
  UNIT_RULES,
  type CartLine,
  type LineSource,
} from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { rupeesInput } from '../catalogue/catalogueData.ts';
import { setSalePrice } from '../catalogue/catalogueRepo.ts';
import { ProductIcon } from '../catalogue/ProductIcon.tsx';
import { useOwnerHere } from '../pin/useOwnerHere.ts';
import { useCartStore } from './cartStore.ts';
import { NumberPad } from './NumberPad.tsx';
import { OwnerPinDialog } from './OwnerPinDialog.tsx';
import { qtyToKeypad, useQtyText, useRs } from './saleFormat.ts';

interface Props {
  source: LineSource & { product_id: string };
  /** Editing this line (tapping a product already in the cart). */
  existing?: CartLine | undefined;
  onClose: () => void;
}

/** A built line, or why it could not be built (core line errors and keypad errors). */
type LineResult = CartLine | { error: string };
const isError = (r: LineResult): r is { error: string } => 'error' in r;

const QTY_ERRORS: Record<string, string> = {
  invalid: 'sale.errors.qty',
  zero: 'sale.errors.qty',
  too_many_decimals: 'sale.errors.decimals',
  too_large: 'sale.errors.tooLarge',
  invalid_qty: 'sale.errors.qty',
  rate_needed: 'sale.errors.rateNeeded',
  amount_too_small: 'sale.errors.amountTooSmall',
};

/** Quantity for one product (US029): quick buttons, keypad, or "By amount" for kg / litre. */
export function QuantityPanel({ source, existing, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const qtyText = useQtyText();
  const put = useCartStore((s) => s.put);
  const remove = useCartStore((s) => s.remove);
  const ownerHere = useOwnerHere();
  const rules = UNIT_RULES[source.unit];

  const [rate, setRate] = useState(existing?.unit_price_paisa ?? source.unit_price_paisa);
  const [step, setStep] = useState<'rate' | 'qty'>(rate === 0 ? 'rate' : 'qty');
  const [rateText, setRateText] = useState('');
  const [saveRate, setSaveRate] = useState(false);
  const [askOwner, setAskOwner] = useState(false);
  const [mode, setMode] = useState<'qty' | 'amount'>(existing?.by_amount ? 'amount' : 'qty');
  const [text, setText] = useState(() =>
    existing
      ? existing.by_amount
        ? rupeesInput(existing.line_total_paisa)
        : qtyToKeypad(existing.qty_milli)
      : '',
  );
  const [error, setError] = useState<string>();
  // When editing, the old quantity is shown but the first key replaces it (like a selected field).
  const [pristine, setPristine] = useState(existing !== undefined);

  const lineSource = { ...source, unit_price_paisa: rate };
  const name = i18n.language === 'ur' ? source.name_ur || source.name : source.name;
  const unit = t(`unit.${source.unit}`);

  function commit(line: LineResult) {
    if (isError(line)) {
      setError(t(QTY_ERRORS[line.error] ?? 'errors.generic'));
      return;
    }
    put(line);
    onClose();
  }

  /** The line for the keypad text, or why there is none yet. */
  function preview(): LineResult | null {
    if (!text) return null;
    if (mode === 'amount') {
      const amount = parseRupees(text, true);
      if (amount.error || amount.paisa === null) return { error: 'invalid' };
      return makeAmountLine(lineSource, amount.paisa, existing?.id);
    }
    const qty = parseQtyInput(text, source.unit);
    if ('error' in qty) return qty;
    return makeLine(lineSource, qty.qty_milli, existing?.id);
  }

  async function applyRate(ownerId: string | null) {
    const parsed = parseRupees(rateText, true);
    if (parsed.error || !parsed.paisa) {
      setError(t('sale.errors.rate'));
      return;
    }
    if (saveRate) {
      if (!ownerId) {
        setAskOwner(true);
        return;
      }
      // Same write as Today's rates: product price + price_history, the owner as actor.
      const product = await db.products.get(source.product_id);
      if (product) await setSalePrice(product, parsed.paisa, ownerId);
    }
    setError(undefined);
    setRate(parsed.paisa);
    setStep('qty');
  }

  const shown = preview();
  const ready = shown && !isError(shown) ? shown : null;

  return (
    <Sheet title={name} onClose={onClose}>
      <div className="flex items-center gap-3">
        <ProductIcon icon={source.icon} />
        <p className="text-muted">
          {rate > 0
            ? t('products.pricePerUnit', { amount: rupeesInput(rate), unit })
            : t('products.noRate')}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}

      {step === 'rate' ? (
        <div className="space-y-3">
          <p className="font-medium">{t('sale.rateForSale', { unit })}</p>
          <p
            className="min-h-12 rounded-xl border border-border px-4 py-2 text-end text-2xl"
            dir="ltr"
            aria-label={t('sale.rateForSale', { unit })}
            aria-live="polite"
          >
            {rateText || '0'}
          </p>
          <NumberPad value={rateText} onChange={setRateText} decimals={2} />
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={saveRate}
              onChange={(e) => setSaveRate(e.target.checked)}
              className="size-5 accent-primary"
            />
            {t('sale.saveAsTodaysRate')}
          </label>
          <Button onClick={() => void applyRate(ownerHere ?? null)}>{t('sale.continue')}</Button>
          {askOwner && (
            <OwnerPinDialog
              onClose={() => setAskOwner(false)}
              onSuccess={(ownerId) => {
                setAskOwner(false);
                void applyRate(ownerId);
              }}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {rules.byAmount && (
            <div role="group" aria-label={t('sale.entryMode')} className="grid grid-cols-2 gap-2">
              {(['qty', 'amount'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setText('');
                    setPristine(false);
                    setError(undefined);
                  }}
                  className={`min-h-11 rounded-md border font-medium ${
                    mode === m
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border bg-surface text-text'
                  }`}
                >
                  {m === 'qty' ? t('sale.byQty') : t('sale.byAmount')}
                </button>
              ))}
            </div>
          )}

          {mode === 'qty' && rules.quick.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {rules.quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => commit(makeLine(lineSource, q, existing?.id))}
                  className="min-h-12 rounded-xl border border-border bg-bg font-semibold text-text"
                >
                  {qtyText(q, source.unit)}
                </button>
              ))}
            </div>
          )}

          <p
            className="min-h-12 rounded-xl border border-border px-4 py-2 text-end text-2xl"
            dir="ltr"
            aria-label={
              mode === 'amount'
                ? t('sale.amountLabel')
                : t('sale.qtyLabel', { unit: source.unit === 'g' ? t('unit.g') : unit })
            }
            aria-live="polite"
          >
            {mode === 'amount' ? t('sale.rs', { amount: text || '0' }) : text || '0'}
          </p>
          <p className="min-h-6 text-muted" aria-live="polite">
            {ready
              ? mode === 'amount'
                ? t('sale.approxFor', {
                    qty: qtyText(ready.qty_milli, source.unit),
                    amount: rs(ready.line_total_paisa),
                  })
                : t('sale.lineTotal', {
                    qty: qtyText(ready.qty_milli, source.unit),
                    rate: rs(rate),
                    total: rs(ready.line_total_paisa),
                  })
              : ''}
          </p>
          <NumberPad
            value={pristine ? '' : text}
            onChange={(v) => {
              setText(v);
              setPristine(false);
              setError(undefined);
            }}
            decimals={mode === 'amount' ? 2 : rules.decimals}
          />
          <Button
            disabled={!text}
            onClick={() => {
              const line = preview();
              if (line) commit(line);
            }}
          >
            {existing ? t('sale.update') : t('sale.add')}
          </Button>
          {existing && (
            <Button
              variant="secondary"
              onClick={() => {
                remove(existing.id);
                onClose();
              }}
            >
              {t('sale.remove')}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
