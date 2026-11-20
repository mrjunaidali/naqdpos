import { useTranslation } from 'react-i18next';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Digits allowed after the decimal point; 0 hides the "." key. */
  decimals: number;
  /** Longest text (keeps typos from growing forever). */
  maxLength?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** On-screen number keypad (44px+ keys), always left-to-right, also in Urdu. */
export function NumberPad({ value, onChange, decimals, maxLength = 9 }: Props) {
  const { t } = useTranslation();
  const press = (key: string) => {
    if (value.length >= maxLength) return;
    if (key === '.') {
      if (decimals === 0 || value.includes('.')) return;
      onChange(value === '' ? '0.' : `${value}.`);
      return;
    }
    const [, frac] = value.split('.');
    if (frac !== undefined && frac.length >= decimals) return;
    onChange(value === '0' ? key : value + key);
  };
  const keyClass =
    'min-h-12 rounded-xl border border-border bg-surface text-xl font-semibold text-text disabled:opacity-40';
  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {KEYS.map((k) => (
        <button key={k} type="button" className={keyClass} onClick={() => press(k)}>
          {k}
        </button>
      ))}
      {decimals > 0 ? (
        <button
          type="button"
          className={keyClass}
          onClick={() => press('.')}
          aria-label={t('sale.decimalPoint')}
        >
          .
        </button>
      ) : (
        <span />
      )}
      <button type="button" className={keyClass} onClick={() => press('0')}>
        0
      </button>
      <button
        type="button"
        className={keyClass}
        aria-label={t('pin.backspace')}
        disabled={value === ''}
        onClick={() => onChange(value.slice(0, -1))}
      >
        ⌫
      </button>
    </div>
  );
}
