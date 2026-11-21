import { parseRupees, type CustomerRow, type StaffRow } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { adjustKhata, KhataNotSaved } from './khataRepo.ts';

/** Owner-only "Adjust balance": add to or reduce the balance, with a required note. */
export function AdjustSheet(props: {
  customer: CustomerRow;
  owner: StaffRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<'add' | 'reduce'>('reduce');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; note?: string; form?: string }>({});

  async function save() {
    const parsed = parseRupees(amount, true);
    const found: typeof errors = {};
    if (parsed.error || !parsed.paisa) found.amount = t('khata.errors.amount');
    if (!note.trim()) found.note = t('khata.errors.noteRequired');
    setErrors(found);
    if (found.amount || found.note || !parsed.paisa) return;
    try {
      await adjustKhata(
        props.customer,
        direction === 'add' ? parsed.paisa : -parsed.paisa,
        note,
        props.owner,
      );
      props.onClose();
    } catch (e) {
      setErrors({
        form: e instanceof KhataNotSaved ? t(`khata.errors.${e.reason}`) : t('errors.generic'),
      });
    }
  }

  return (
    <Sheet title={t('khata.adjustTitle')} onClose={props.onClose}>
      <div role="group" aria-label={t('khata.direction')} className="flex gap-2">
        {(['reduce', 'add'] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={direction === d}
            onClick={() => setDirection(d)}
            className={`min-h-11 flex-1 rounded-full border px-4 font-medium ${
              direction === d
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface text-text'
            }`}
          >
            {t(`khata.${d}`)}
          </button>
        ))}
      </div>
      <Field
        label={t('khata.amount')}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        error={errors.amount}
      />
      <Field
        label={t('khata.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        autoComplete="off"
        error={errors.note}
        required
      />
      {errors.form && (
        <p role="alert" className="text-danger">
          {errors.form}
        </p>
      )}
      <Button onClick={() => void save()}>{t('khata.saveAdjustment')}</Button>
    </Sheet>
  );
}
