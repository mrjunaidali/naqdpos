import { checkDiscount, discountOn, parseRupees, type Discount } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../ui/Button.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { rupeesInput } from '../catalogue/catalogueData.ts';
import { NumberPad } from './NumberPad.tsx';
import { useRs } from './saleFormat.ts';

interface Props {
  title: string;
  /** What the discount applies to (the line's price, or the subtotal for the bill). */
  basePaisa: number;
  initial: Discount | null;
  onApply: (discount: Discount) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** A discount in rupees or a whole percent (US032), shown live; never more than the base. */
export function DiscountSheet({ title, basePaisa, initial, onApply, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const rs = useRs();
  const [kind, setKind] = useState<Discount['kind']>(initial?.kind ?? 'rs');
  const [text, setText] = useState(() =>
    initial ? (initial.kind === 'rs' ? rupeesInput(initial.value) : String(initial.value)) : '',
  );
  const [error, setError] = useState<string>();

  function typed(): Discount | null {
    if (!text) return null;
    if (kind === 'pct') return { kind, value: Number(text) };
    const paisa = parseRupees(text, true).paisa;
    return paisa === null ? null : { kind, value: paisa };
  }
  const discount = typed();
  const problem = discount ? checkDiscount(basePaisa, discount) : null;
  const amount = discount && !problem ? discountOn(basePaisa, discount) : 0;

  function apply() {
    if (!discount || problem) {
      setError(t(problem === 'too_much' ? 'discount.errors.tooMuch' : 'discount.errors.bad'));
      return;
    }
    onApply(discount);
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div role="group" aria-label={t('discount.kind')} className="flex gap-2">
        {(['rs', 'pct'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setText('');
              setError(undefined);
            }}
            className={`min-h-11 flex-1 rounded-full border px-4 font-medium ${
              kind === k
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface text-text'
            }`}
          >
            {t(`discount.${k}`)}
          </button>
        ))}
      </div>
      <p
        aria-label={t('discount.typed')}
        dir="ltr"
        className="min-h-12 rounded-xl border border-border px-4 py-2 text-end text-2xl"
      >
        {kind === 'rs' ? t('sale.rs', { amount: text || '0' }) : `${text || '0'}%`}
      </p>
      <p className="text-muted" aria-live="polite">
        {t('discount.preview', { amount: rs(amount), of: rs(basePaisa) })}
      </p>
      <NumberPad
        value={text}
        onChange={(v) => {
          setText(v);
          setError(undefined);
        }}
        decimals={kind === 'rs' ? 2 : 0}
        maxLength={kind === 'pct' ? 3 : 9}
      />
      {error && <Alert>{error}</Alert>}
      <Button disabled={!text} onClick={apply}>
        {t('discount.apply')}
      </Button>
      {initial && (
        <Button variant="secondary" onClick={onRemove}>
          {t('discount.remove')}
        </Button>
      )}
    </Sheet>
  );
}
