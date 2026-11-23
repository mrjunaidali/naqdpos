import {
  businessDate,
  closableDays,
  DENOMINATIONS,
  denominationTotal,
  expectedCash,
  openingDefault,
  parseRupees,
} from '@naqdpos/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDates } from '../../i18n/format.ts';
import { Link, useNavigate } from 'react-router';
import { db } from '../../db/schema.ts';
import { syncEngine } from '../../sync/index.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { rupeesInput } from '../catalogue/catalogueData.ts';
import { categoryName, useExpenseCategories } from '../expenses/expenseRepo.ts';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { useRs } from '../sale/saleFormat.ts';
import { syncBeforeCount } from '../stock/stockRepo.ts';
import { useClosedDates } from './closedDates.ts';
import {
  closeDay,
  CloseNotSaved,
  useActivityDates,
  useDayCloses,
  useDayRows,
} from './closingData.ts';

/**
 * Close day (US044, US067; owner): sync first, then opening cash, cash in and out, owner
 * withdrawal, expected cash, the count, the difference. A close is final.
 */
export function ClosePage() {
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const navigate = useNavigate();
  const rs = useRs();
  const actor = useActingOwnerId();
  const closed = useClosedDates();
  const activity = useActivityDates();
  const closes = useDayCloses();
  const categories = useExpenseCategories() ?? [];
  const [sync, setSync] = useState<'running' | 'done' | 'offline'>('running');
  const [opening, setOpening] = useState<string | null>(null);
  const [withdrawal, setWithdrawal] = useState('');
  const [mode, setMode] = useState<'total' | 'notes'>('total');
  const [countedText, setCountedText] = useState('');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void syncBeforeCount(() => syncEngine.syncNow()).then((ok) => setSync(ok ? 'done' : 'offline'));
  }, []);

  const days =
    closed && activity ? closableDays(activity, closed, businessDate(new Date())) : undefined;
  const date = days?.[0];
  const rows = useDayRows(date);
  if (sync === 'running') return <p className="text-muted">{t('closing.syncing')}</p>;
  if (!days || !closes) return null;
  if (!date) {
    return (
      <section className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">{t('closing.title')}</h1>
        <p className="text-muted">{t('closing.nothingToClose')}</p>
        <Link to="/closing/history" className="underline">
          {t('closing.history')}
        </Link>
      </section>
    );
  }
  if (!rows) return null;

  const previous = closes.find((c) => c.business_date < date);
  const openingPaisa =
    parseRupees(opening ?? rupeesInput(openingDefault(previous)), false).paisa ?? 0;
  const withdrawalPaisa = parseRupees(withdrawal, false).paisa ?? 0;
  const cash = (kind: string) =>
    rows.payments
      .filter((p) => p.kind === kind && p.method_code === 'cash')
      .reduce((s, p) => s + p.amount_paisa, 0);
  const cashExpenses = rows.expenses.filter((e) => e.paid_method_code === 'cash');
  const byCategory = new Map<string, number>();
  for (const e of cashExpenses)
    byCategory.set(e.category_id, (byCategory.get(e.category_id) ?? 0) + e.amount_paisa);
  const expensesTotal = cashExpenses.reduce((s, e) => s + e.amount_paisa, 0);
  const expected = expectedCash({
    openingPaisa,
    payments: rows.payments,
    expenses: rows.expenses,
    withdrawalPaisa,
  });
  const counted =
    mode === 'notes'
      ? denominationTotal(
          Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0])),
        )
      : (parseRupees(countedText, false).paisa ?? 0);
  const difference = counted - expected;
  const diffClass =
    difference < 0 ? 'text-danger' : difference > 0 ? 'text-warning' : 'text-success';
  const catName = (id: string) => {
    const c = categories.find((x) => x.id === id);
    return c ? categoryName(c, t, i18n.language) : '—';
  };

  async function confirm() {
    const owner = await db.staff.get(actor);
    if (!owner) return;
    const offlineNote = sync === 'offline' ? t('closing.offlineNote') : '';
    try {
      await closeDay(
        {
          businessDate: date!,
          openingPaisa,
          expectedPaisa: expected,
          countedPaisa: counted,
          withdrawalPaisa,
          note: [offlineNote, note.trim()].filter(Boolean).join(' — ') || null,
        },
        owner,
      );
      void navigate(`/closing/${date}`, { replace: true });
    } catch (e) {
      setConfirming(false);
      setError(t(`closing.errors.${e instanceof CloseNotSaved ? e.reason : 'generic'}`));
    }
  }

  const line = (label: string, value: number, strong = false) => (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd dir="ltr">{rs(value)}</dd>
    </div>
  );

  return (
    <section className="mx-auto max-w-md space-y-4 pb-8">
      <h1 className="text-2xl font-bold">{t('closing.titleFor', { date: dates.date(date) })}</h1>
      {days.length > 1 && (
        <Alert tone="info">{t('closing.olderFirst', { count: days.length })}</Alert>
      )}
      {sync === 'offline' && <Alert>{t('closing.offlineWarning')}</Alert>}
      <Field
        label={t('closing.opening')}
        value={opening ?? rupeesInput(openingDefault(previous))}
        onChange={(e) => setOpening(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        hint={previous ? t('closing.openingHint') : t('closing.firstClose')}
      />
      <dl className="space-y-1 rounded-2xl border border-border bg-surface p-3">
        {line(t('closing.cashSales'), cash('sale'))}
        {line(t('closing.cashKhata'), cash('khata_receipt'))}
        {line(t('closing.cashExpenses'), -expensesTotal)}
        {[...byCategory].map(([id, amount]) => (
          <div key={id} className="flex justify-between ps-4 text-sm text-muted">
            <dt>{catName(id)}</dt>
            <dd dir="ltr">{rs(amount)}</dd>
          </div>
        ))}
      </dl>
      <Field
        label={t('closing.withdrawal')}
        hint={t('closing.withdrawalHint')}
        value={withdrawal}
        onChange={(e) => setWithdrawal(e.target.value)}
        inputMode="decimal"
        dir="ltr"
      />
      <p className="flex justify-between rounded-2xl bg-hero p-4 text-lg font-bold text-hero-fg">
        <span>{t('closing.expected')}</span>
        <span dir="ltr">{rs(expected)}</span>
      </p>

      <fieldset className="space-y-2">
        <legend className="font-medium">{t('closing.counted')}</legend>
        <div className="flex gap-2">
          {(['total', 'notes'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-11 flex-1 rounded-full border px-4 font-medium ${
                mode === m
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {t(`closing.mode.${m}`)}
            </button>
          ))}
        </div>
        {mode === 'total' ? (
          <Field
            label={t('closing.countedTotal')}
            value={countedText}
            onChange={(e) => setCountedText(e.target.value)}
            inputMode="decimal"
            dir="ltr"
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {DENOMINATIONS.map((d) => (
              <label key={d.paisa} className="flex items-center gap-2">
                <span className="w-24 text-sm" dir="ltr">
                  {t(d.coin ? 'closing.coin' : 'closing.note', { amount: rs(d.paisa) })}
                </span>
                <input
                  inputMode="numeric"
                  dir="ltr"
                  value={counts[d.paisa] ?? ''}
                  onChange={(e) =>
                    setCounts((c) => ({ ...c, [d.paisa]: e.target.value.replace(/\D/g, '') }))
                  }
                  aria-label={t('closing.countOf', { amount: rs(d.paisa) })}
                  className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-end"
                />
              </label>
            ))}
            <p className="col-span-2 text-end font-semibold" dir="ltr">
              {rs(counted)}
            </p>
          </div>
        )}
      </fieldset>
      <p className={`flex justify-between text-lg font-bold ${diffClass}`} aria-live="polite">
        <span>
          {difference < 0
            ? t('closing.short')
            : difference > 0
              ? t('closing.over')
              : t('closing.exact')}
        </span>
        <span dir="ltr">{rs(Math.abs(difference))}</span>
      </p>
      <Field
        label={t('closing.noteLabel')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={400}
      />
      {error && <Alert>{error}</Alert>}
      {confirming ? (
        <div className="space-y-2 rounded-xl border border-warning bg-warning-soft p-3 text-warning-fg">
          <p className="font-semibold">{t('closing.confirm', { date: dates.date(date) })}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirm()}>{t('closing.closeNow')}</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)}>{t('closing.closeDay')}</Button>
      )}
      <Link to="/closing/history" className="inline-flex min-h-11 items-center underline">
        {t('closing.history')}
      </Link>
    </section>
  );
}
