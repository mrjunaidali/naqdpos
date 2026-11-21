import { describe, expect, it } from 'vitest';
import { ExpenseRowSchema } from './api/schemas.ts';
import {
  buildExpense,
  buildReversal,
  canReverse,
  defaultExpenseCategories,
  expenseTotals,
  needsOwnerApproval,
  type ExpenseRow,
} from './expenses.ts';

const SHOP = '019a9b8e-0000-7000-8000-000000000001';
const CASHIER = '019a9b8e-0000-7000-8000-000000000002';
const OWNER = '019a9b8e-0000-7000-8000-000000000003';
const CAT = '019a9b8e-0000-7000-8000-000000000004';
const now = new Date('2026-11-22T10:00:00Z');
const ctx = {
  shopId: SHOP,
  deviceId: null,
  staffId: CASHIER,
  role: 'cashier' as const,
  now,
  limitPaisa: 200_000,
};
const input = (amount: number) => ({ categoryId: CAT, amountPaisa: amount, methodCode: 'cash' });
const row = (r: ReturnType<typeof buildExpense>) => r as ExpenseRow;

describe('defaults', () => {
  it('fruit & veg get Mandi transport; others do not; never Wastage', () => {
    expect(defaultExpenseCategories('fruit_veg').map((d) => d.name)).toEqual([
      'Mandi transport',
      'Rent',
      'Bijli/gas',
      'Staff salary',
      'Staff advance',
      'Petrol',
      'Shopping bags',
      'Other',
    ]);
    for (const type of ['grocery', 'meat', 'general'] as const) {
      const names = defaultExpenseCategories(type).map((d) => d.name);
      expect(names).toHaveLength(7);
      expect(names).not.toContain('Mandi transport');
    }
    expect(defaultExpenseCategories('fruit_veg').some((d) => /wastage/i.test(d.name))).toBe(false);
  });
});

describe('recording', () => {
  it('needsOwnerApproval: cashier above the limit only', () => {
    expect(needsOwnerApproval(200_000, 'cashier', 200_000)).toBe(false);
    expect(needsOwnerApproval(200_001, 'cashier', 200_000)).toBe(true);
    expect(needsOwnerApproval(9_999_999, 'owner', 0)).toBe(false);
  });

  it('a cashier within the limit; above it only with an owner approval, which is stored', () => {
    const ok = row(buildExpense({ ...input(50_000), note: ' bags ', payee: '' }, ctx));
    expect(ok).toMatchObject({
      amount_paisa: 50_000,
      staff_id: CASHIER,
      business_date: '2026-11-22',
      note: 'bags',
      payee: null,
      approved_by_staff_id: null,
    });
    expect(ExpenseRowSchema.safeParse(ok).success).toBe(true);
    expect(buildExpense(input(250_000), ctx)).toEqual({ error: 'needs_owner' });
    expect(
      row(buildExpense(input(250_000), { ...ctx, approvedByStaffId: OWNER })).approved_by_staff_id,
    ).toBe(OWNER);
  });

  it('refuses riders and zero amounts; rolls past a closed day', () => {
    expect(buildExpense(input(100), { ...ctx, role: 'rider' })).toEqual({ error: 'forbidden' });
    expect(buildExpense(input(0), ctx)).toEqual({ error: 'bad_amount' });
    // After today is closed, a new expense counts for the next day (it never blocks).
    expect(
      row(buildExpense(input(100), { ...ctx, closedDates: new Set(['2026-11-22']) })).business_date,
    ).toBe('2026-11-23');
  });
});

describe('reversals', () => {
  const original = row(
    buildExpense(input(30_000), { ...ctx, now: new Date('2026-11-20T10:00:00Z') }),
  );
  const owner = { ...ctx, staffId: OWNER, role: 'owner' as const };

  it('negative amount, reason, dated today (also when the original day is closed)', () => {
    const r = row(
      buildReversal(original, [original], ' wrong amount ', {
        ...owner,
        closedDates: new Set(['2026-11-20']),
      }),
    );
    expect(r).toMatchObject({
      amount_paisa: -30_000,
      reverses_expense_id: original.id,
      reversal_reason: 'wrong amount',
      business_date: '2026-11-22',
      category_id: CAT,
      paid_method_code: 'cash',
      staff_id: OWNER,
    });
    expect(ExpenseRowSchema.safeParse(r).success).toBe(true);
  });

  it('owner only, reason required, once only, never a reversal', () => {
    expect(buildReversal(original, [original], 'x', ctx)).toEqual({ error: 'forbidden' });
    expect(buildReversal(original, [original], '  ', owner)).toEqual({ error: 'reason_required' });
    const r = row(buildReversal(original, [original], 'x', owner));
    expect(canReverse(original, [original, r])).toEqual({ ok: false, reason: 'already_reversed' });
    expect(canReverse(r, [original, r])).toEqual({ ok: false, reason: 'is_reversal' });
    expect(buildReversal(original, [original, r], 'x', owner)).toEqual({
      error: 'already_reversed',
    });
    expect(canReverse(original, [original])).toEqual({ ok: true });
  });
});

describe('totals', () => {
  it('by category and method, reversals netted, within the date range', () => {
    const e = (date: string, cat: string, method: string, amount: number) => ({
      business_date: date,
      category_id: cat,
      paid_method_code: method,
      amount_paisa: amount,
    });
    const all = [
      e('2026-11-21', 'rent', 'cash', 1_000_000),
      e('2026-11-22', 'petrol', 'cash', 50_000),
      e('2026-11-22', 'petrol', 'jazzcash', 20_000),
      e('2026-11-22', 'bags', 'cash', 30_000),
      e('2026-11-22', 'bags', 'cash', -30_000), // reversal
    ];
    const today = expenseTotals(all, { from: '2026-11-22', to: '2026-11-22' });
    expect(today.total_paisa).toBe(70_000);
    expect(Object.fromEntries(today.byCategory)).toEqual({ petrol: 70_000 });
    expect(Object.fromEntries(today.byMethod)).toEqual({ cash: 50_000, jazzcash: 20_000 });
    expect(expenseTotals(all).total_paisa).toBe(1_070_000);
  });
});
