import { canAddExpense, needsOwnerApproval, parseRupees } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useOnline } from '../../app/useOnline.ts';
import { db } from '../../db/schema.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { showToast } from '../../ui/toastStore.ts';
import { OwnerPinDialog } from '../sale/OwnerPinDialog.tsx';
import { methodName, usePaymentMethods } from '../settings/paymentMethods.ts';
import {
  addExpense,
  categoryName,
  expenseLimit,
  ExpenseNotSaved,
  useExpenseCategories,
} from './expenseRepo.ts';

const chip = (on: boolean) =>
  `min-h-11 rounded-full border px-4 font-medium ${
    on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-text'
  }`;

/** Add expense (US046): category, amount, method, note, payee. Offline; owner PIN above the limit. */
export function AddExpensePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const current = useCurrentStaff();
  const categories = (useExpenseCategories() ?? []).filter((c) => c.archived_at === null);
  const methods = usePaymentMethods();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [payee, setPayee] = useState('');
  const [error, setError] = useState<string>();
  const [askOwner, setAskOwner] = useState(false);
  const [busy, setBusy] = useState(false);

  const staff = current?.valid ? current.staff : null;
  if (current !== undefined && !canAddExpense(staff?.role)) {
    return <Alert>{t('expenses.errors.forbidden')}</Alert>;
  }
  const active = (methods ?? []).filter((m) => m.active);
  const chips = active.some((m) => m.code === 'cash')
    ? active
    : [{ id: 'cash', code: 'cash', label: 'Cash' }, ...active];

  async function save(approvedBy: string | null) {
    if (!staff) return;
    const parsed = parseRupees(amount, true);
    if (!categoryId) return setError(t('expenses.errors.no_category'));
    if (parsed.error || !parsed.paisa) return setError(t('expenses.errors.bad_amount'));
    if (!approvedBy && needsOwnerApproval(parsed.paisa, staff.role, await expenseLimit())) {
      setAskOwner(true);
      return;
    }
    setBusy(true);
    try {
      await addExpense(
        { categoryId, amountPaisa: parsed.paisa, methodCode: method, note, payee },
        staff,
        approvedBy,
      );
      showToast(online ? t('expenses.saved') : t('expenses.savedOffline'));
      void navigate('/expenses', { replace: true });
    } catch (e) {
      setError(t(`expenses.errors.${e instanceof ExpenseNotSaved ? e.reason : 'generic'}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4 pb-8">
      <h1 className="text-2xl font-bold">{t('expenses.addTitle')}</h1>
      <div role="group" aria-label={t('expenses.category')} className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={categoryId === c.id}
            onClick={() => setCategoryId(c.id)}
            className={chip(categoryId === c.id)}
          >
            {categoryName(c, t, i18n.language)}
          </button>
        ))}
      </div>
      <Field
        label={t('expenses.amount')}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setError(undefined);
        }}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
      />
      <div role="group" aria-label={t('pay.method')} className="flex flex-wrap gap-2">
        {chips.map((m) => (
          <button
            key={m.code}
            type="button"
            aria-pressed={method === m.code}
            onClick={() => setMethod(m.code)}
            className={chip(method === m.code)}
          >
            {methodName(m, t)}
          </button>
        ))}
      </div>
      <Field
        label={t('expenses.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
      />
      <Field
        label={t('expenses.payee')}
        value={payee}
        onChange={(e) => setPayee(e.target.value)}
        maxLength={60}
      />
      {error && <Alert>{error}</Alert>}
      <Button disabled={busy || !staff} onClick={() => void save(null)}>
        {busy ? t('common.wait') : t('expenses.save')}
      </Button>
      {askOwner && (
        <OwnerPinDialog
          message={t('expenses.ownerNeeded')}
          onClose={() => setAskOwner(false)}
          onSuccess={(ownerId) => {
            setAskOwner(false);
            void db.staff.get(ownerId).then((o) => (o ? save(o.id) : undefined));
          }}
        />
      )}
    </section>
  );
}
