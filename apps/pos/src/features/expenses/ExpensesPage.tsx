import { can, canAddExpense, expenseTotals } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { db } from '../../db/schema.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { useOwnerHere } from '../pin/useOwnerHere.ts';
import { OwnerPinDialog } from '../sale/OwnerPinDialog.tsx';
import { useRs } from '../sale/saleFormat.ts';
import { methodName, usePaymentMethods } from '../settings/paymentMethods.ts';
import {
  categoryName,
  ExpenseNotSaved,
  reverseExpense,
  today,
  useExpenseCategories,
  useExpenses,
} from './expenseRepo.ts';

/** Owners see every expense; cashiers only their own for today (UI rule, like sales). */
function useViewer() {
  const current = useCurrentStaff();
  const staff = current?.valid ? current.staff : null;
  return { ready: current !== undefined, staff, isOwner: staff?.role === 'owner' };
}

/** Today's expenses (US046, minimal: the report is US068). */
export function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const viewer = useViewer();
  const expenses = useExpenses();
  const categories = useExpenseCategories() ?? [];
  if (!expenses || !viewer.ready) return null;
  const date = today();
  const shown = expenses
    .filter((e) => e.business_date === date && (viewer.isOwner || e.staff_id === viewer.staff?.id))
    .sort((a, b) => b.id.localeCompare(a.id));
  const total = expenseTotals(shown).total_paisa;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const reversed = new Set(expenses.map((e) => e.reverses_expense_id).filter(Boolean));

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{t('expenses.title')}</h1>
      <div className="rounded-2xl bg-hero p-4 text-hero-fg">
        <p className="text-sm text-hero-muted">{t('expenses.todayTotal')}</p>
        <p className="text-3xl font-bold" dir="ltr">
          {rs(total)}
        </p>
      </div>
      {canAddExpense(viewer.staff?.role) && (
        <Link
          to="/expenses/new"
          className="flex min-h-12 items-center justify-center rounded-md bg-primary font-semibold text-primary-fg"
        >
          {t('expenses.add')}
        </Link>
      )}
      {shown.length === 0 ? (
        <p className="text-muted">{t('expenses.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {shown.map((e) => {
            const cat = byId.get(e.category_id);
            return (
              <li key={e.id}>
                <Link
                  to={`/expenses/${e.id}`}
                  className="flex min-h-12 items-center gap-2 px-3 py-2"
                >
                  <span className="flex-1">
                    {cat ? categoryName(cat, t, i18n.language) : '—'}
                    {e.reverses_expense_id && (
                      <span className="ms-2 text-xs text-muted">{t('expenses.reversal')}</span>
                    )}
                    {reversed.has(e.id) && (
                      <span className="ms-2 rounded-full bg-warning-soft px-2 text-xs text-warning-fg">
                        {t('expenses.reversed')}
                      </span>
                    )}
                  </span>
                  <span dir="ltr">{rs(e.amount_paisa)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Expense detail (US066): everything about it; the owner can reverse it (reason required). */
export function ExpenseDetailPage() {
  const { expenseId } = useParams();
  const { t, i18n } = useTranslation();
  const rs = useRs();
  const viewer = useViewer();
  const ownerHere = useOwnerHere();
  const methods = usePaymentMethods() ?? [];
  const expenses = useExpenses();
  const categories = useExpenseCategories() ?? [];
  const people = useLiveQuery(() => db.staff.toArray()) ?? [];
  const [reversing, setReversing] = useState(false);
  const [askOwner, setAskOwner] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  if (!expenses || !viewer.ready) return null;
  const e = expenses.find((x) => x.id === expenseId);
  if (!e || (!viewer.isOwner && (e.staff_id !== viewer.staff?.id || e.business_date !== today()))) {
    return <p className="text-muted">{t('expenses.notFound')}</p>;
  }
  const cat = categories.find((c) => c.id === e.category_id);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—';
  const reversal = expenses.find((x) => x.reverses_expense_id === e.id);
  const canReverseHere =
    !e.reverses_expense_id && !reversal && can(viewer.staff?.role ?? null, 'manage_expenses');
  const method = methods.find((m) => m.code === e.paid_method_code) ?? {
    code: e.paid_method_code,
    label: e.paid_method_code,
  };

  async function reverse(owner: string) {
    const staff = await db.staff.get(owner);
    if (!staff) return;
    try {
      await reverseExpense(e!, reason, staff);
      setReversing(false);
    } catch (err) {
      setError(t(`expenses.errors.${err instanceof ExpenseNotSaved ? err.reason : 'generic'}`));
    }
  }

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{cat ? categoryName(cat, t, i18n.language) : '—'}</h1>
      <p className="text-3xl font-bold" dir="ltr">
        {rs(e.amount_paisa)}
      </p>
      {reversal && (
        <p className="rounded-xl border border-warning bg-warning-soft p-3 text-warning-fg">
          {t('expenses.reversedBy', { reason: reversal.reversal_reason ?? '' })}
        </p>
      )}
      <dl className="space-y-1 rounded-2xl border border-border bg-surface p-3">
        {row(t('expenses.date'), e.business_date)}
        {row(t('pay.method'), methodName(method, t))}
        {e.note && row(t('expenses.note'), e.note)}
        {e.payee && row(t('expenses.payee'), e.payee)}
        {row(t('expenses.addedBy'), name(e.staff_id))}
        {e.approved_by_staff_id && row(t('expenses.approvedBy'), name(e.approved_by_staff_id))}
        {e.reversal_reason && row(t('expenses.reason'), e.reversal_reason)}
      </dl>
      {e.reverses_expense_id && (
        <Link to={`/expenses/${e.reverses_expense_id}`} className="underline">
          {t('expenses.original')}
        </Link>
      )}
      {canReverseHere && !reversing && (
        <Button
          variant="secondary"
          onClick={() => {
            if (ownerHere) {
              setOwnerId(ownerHere);
              setReversing(true);
            } else setAskOwner(true);
          }}
        >
          {t('expenses.reverse')}
        </Button>
      )}
      {reversing && ownerId && (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
          <Field
            label={t('expenses.reason')}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            maxLength={200}
            error={error}
          />
          <Button
            onClick={() => {
              if (!reason.trim()) return setError(t('expenses.errors.reason_required'));
              void reverse(ownerId);
            }}
          >
            {t('expenses.confirmReverse', { amount: rs(e.amount_paisa) })}
          </Button>
        </div>
      )}
      {askOwner && (
        <OwnerPinDialog
          message={t('expenses.ownerToReverse')}
          onClose={() => setAskOwner(false)}
          onSuccess={(id) => {
            setAskOwner(false);
            setOwnerId(id);
            setReversing(true);
          }}
        />
      )}
      <Link to="/expenses" className="inline-flex min-h-11 items-center underline">
        {t('expenses.back')}
      </Link>
    </section>
  );
}
