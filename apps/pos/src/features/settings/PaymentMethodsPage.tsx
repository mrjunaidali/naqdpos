import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import {
  addCustomMethod,
  methodName,
  moveMethod,
  setMethodActive,
  usePaymentMethods,
} from './paymentMethods.ts';

/** Settings → Payment methods (US035, owner screen): enable, disable, add, reorder. */
export function PaymentMethodsPage() {
  const { t } = useTranslation();
  const actor = useActingOwnerId();
  const methods = usePaymentMethods();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string>();

  async function add(event: FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (!name) return setError(t('products.errors.required'));
    if (name.length > 40) return setError(t('products.errors.tooLong'));
    setError(undefined);
    await addCustomMethod(name, actor);
    setLabel('');
  }

  if (!methods) return null;
  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{t('paymentMethods.title')}</h1>
      <p className="text-muted">{t('paymentMethods.intro')}</p>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {methods.map((m, i) => {
          const name = methodName(m, t);
          return (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 font-medium">{name}</span>
              <button
                type="button"
                aria-pressed={m.active}
                disabled={m.code === 'cash'}
                title={m.code === 'cash' ? t('paymentMethods.cashAlwaysOn') : undefined}
                onClick={() => void setMethodActive(m, !m.active, actor)}
                aria-label={t('paymentMethods.toggle', { name })}
                className={`min-h-11 rounded-full border px-3 text-sm font-medium disabled:opacity-60 ${
                  m.active
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'border-border bg-surface text-muted'
                }`}
              >
                {m.active ? t('paymentMethods.on') : t('paymentMethods.off')}
              </button>
              <button
                type="button"
                disabled={i === 0}
                onClick={() => void moveMethod(m.id, -1, actor)}
                aria-label={t('categories.moveUp', { name })}
                className="min-h-11 min-w-11 rounded-md border border-border disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={i === methods.length - 1}
                onClick={() => void moveMethod(m.id, 1, actor)}
                aria-label={t('categories.moveDown', { name })}
                className="min-h-11 min-w-11 rounded-md border border-border disabled:opacity-40"
              >
                ↓
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="space-y-3 rounded-2xl border border-border bg-surface p-4"
        onSubmit={(e) => void add(e)}
        noValidate
      >
        <h2 className="text-lg font-semibold">{t('paymentMethods.addTitle')}</h2>
        {error && <Alert>{error}</Alert>}
        <Field
          label={t('paymentMethods.label')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          hint={t('paymentMethods.labelHint')}
          autoComplete="off"
        />
        <Button type="submit">{t('paymentMethods.add')}</Button>
      </form>
    </section>
  );
}
