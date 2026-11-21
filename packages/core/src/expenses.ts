// Expenses (US065, US046, US066; docs/features/expense-management.md). Append-only: a wrong
// expense is fixed by a reversal row (owner only), never by editing. Money is integer paisa.
import { uuidv7 } from './ids.ts';
import type { Paisa } from './money.ts';
import { businessDateFor } from './sale.ts';
import type { Role, ShopType } from './tenancy.ts';

export interface ExpenseCategoryRow {
  id: string;
  shop_id: string;
  name: string;
  /** Owner-typed Urdu name (approved 22 Nov 2026). */
  name_ur: string | null;
  /** expense.cat.<key> for seeded defaults (shown through i18n until renamed). */
  i18n_key: string | null;
  icon: string | null;
  sort: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
  server_seq: number | null;
}

export interface ExpenseRow {
  id: string;
  shop_id: string;
  business_date: string;
  category_id: string;
  /** > 0; negative only for reversals. */
  amount_paisa: Paisa;
  paid_method_code: string;
  note: string | null;
  payee: string | null;
  payee_staff_id: string | null;
  staff_id: string;
  approved_by_staff_id: string | null;
  reverses_expense_id: string | null;
  reversal_reason: string | null;
  recurring_expense_id: string | null;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

/**
 * Default categories (same as seed_expense_categories() in SQL). No "Wastage": wastage is a stock
 * movement (US025) valued from cost history in reports; an expense would count it twice.
 */
export const EXPENSE_CATEGORY_DEFAULTS = [
  { key: 'mandi_transport', name: 'Mandi transport', fruitVegOnly: true },
  { key: 'rent', name: 'Rent', fruitVegOnly: false },
  { key: 'bijli_gas', name: 'Bijli/gas', fruitVegOnly: false },
  { key: 'staff_salary', name: 'Staff salary', fruitVegOnly: false },
  { key: 'staff_advance', name: 'Staff advance', fruitVegOnly: false },
  { key: 'petrol', name: 'Petrol', fruitVegOnly: false },
  { key: 'shopping_bags', name: 'Shopping bags', fruitVegOnly: false },
  { key: 'other', name: 'Other', fruitVegOnly: false },
] as const;

export function defaultExpenseCategories(type: ShopType) {
  return EXPENSE_CATEGORY_DEFAULTS.filter((d) => !d.fruitVegOnly || type === 'fruit_veg');
}

export const MAX_EXPENSE_NOTE = 200;
export const MAX_EXPENSE_PAYEE = 60;
export const MAX_CATEGORY_NAME = 40;

// --- Rules ---

/** A cashier above the shop limit needs the owner's PIN; owners never do. */
export function needsOwnerApproval(
  amountPaisa: Paisa,
  role: Role | null | undefined,
  limitPaisa: Paisa,
) {
  return role !== 'owner' && amountPaisa > limitPaisa;
}

export function canAddExpense(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'cashier';
}

export type ReverseBlock = 'is_reversal' | 'already_reversed';

/** An expense can be reversed once; a reversal cannot be reversed. */
export function canReverse(
  expense: Pick<ExpenseRow, 'id' | 'reverses_expense_id'>,
  all: readonly Pick<ExpenseRow, 'reverses_expense_id'>[],
): { ok: true } | { ok: false; reason: ReverseBlock } {
  if (expense.reverses_expense_id) return { ok: false, reason: 'is_reversal' };
  if (all.some((e) => e.reverses_expense_id === expense.id)) {
    return { ok: false, reason: 'already_reversed' };
  }
  return { ok: true };
}

/** A business date is closed when the shop has a day close for it (day_closes, US044). */
export function isDayClosed(date: string, closedDates: ReadonlySet<string> | readonly string[]) {
  return closedDates instanceof Set
    ? closedDates.has(date)
    : (closedDates as readonly string[]).includes(date);
}

export interface ExpenseContext {
  shopId: string;
  deviceId: string | null;
  staffId: string;
  role: Role | null | undefined;
  now: Date;
  /** shops.cashier_expense_limit_paisa */
  limitPaisa: Paisa;
  /** The owner who entered their PIN for an amount above the limit. */
  approvedByStaffId?: string | null | undefined;
  closedDates?: ReadonlySet<string> | undefined;
}

export type ExpenseError =
  | 'forbidden'
  | 'bad_amount'
  | 'needs_owner'
  | 'day_closed'
  | 'no_category'
  | 'no_method'
  | 'note_too_long'
  | 'payee_too_long'
  | 'reason_required'
  | ReverseBlock;

export function buildExpense(
  input: {
    categoryId: string;
    amountPaisa: Paisa;
    methodCode: string;
    note?: string | null;
    payee?: string | null;
  },
  ctx: ExpenseContext,
): ExpenseRow | { error: ExpenseError } {
  if (!canAddExpense(ctx.role)) return { error: 'forbidden' };
  if (!Number.isSafeInteger(input.amountPaisa) || input.amountPaisa <= 0) {
    return { error: 'bad_amount' };
  }
  if (!input.categoryId) return { error: 'no_category' };
  if (!input.methodCode) return { error: 'no_method' };
  const note = input.note?.trim() || null;
  const payee = input.payee?.trim() || null;
  if (note && [...note].length > MAX_EXPENSE_NOTE) return { error: 'note_too_long' };
  if (payee && [...payee].length > MAX_EXPENSE_PAYEE) return { error: 'payee_too_long' };
  const needs = needsOwnerApproval(input.amountPaisa, ctx.role, ctx.limitPaisa);
  if (needs && !ctx.approvedByStaffId) return { error: 'needs_owner' };
  // After closing, a new expense counts for the next open day (it never blocks).
  const date = businessDateFor(ctx.now, ctx.closedDates);
  return {
    id: uuidv7(),
    shop_id: ctx.shopId,
    business_date: date,
    category_id: input.categoryId,
    amount_paisa: input.amountPaisa,
    paid_method_code: input.methodCode,
    note,
    payee,
    payee_staff_id: null,
    staff_id: ctx.staffId,
    approved_by_staff_id: needs ? (ctx.approvedByStaffId ?? null) : null,
    reverses_expense_id: null,
    reversal_reason: null,
    recurring_expense_id: null,
    created_at: ctx.now.toISOString(),
    device_id: ctx.deviceId,
    server_seq: null,
  };
}

/**
 * The reversal of an expense (owner only, reason required): −amount, same category and method.
 * Dated today; it is the original's date too when that is today, and never a closed date.
 */
export function buildReversal(
  original: ExpenseRow,
  all: readonly ExpenseRow[],
  reason: string,
  ctx: Omit<ExpenseContext, 'limitPaisa'>,
): ExpenseRow | { error: ExpenseError } {
  if (ctx.role !== 'owner') return { error: 'forbidden' };
  const check = canReverse(original, all);
  if (!check.ok) return { error: check.reason };
  const text = reason.trim();
  if (!text) return { error: 'reason_required' };
  if ([...text].length > MAX_EXPENSE_NOTE) return { error: 'note_too_long' };
  const today = businessDateFor(ctx.now, ctx.closedDates);
  return {
    ...original,
    id: uuidv7(),
    business_date: today,
    amount_paisa: -original.amount_paisa,
    note: null,
    staff_id: ctx.staffId,
    approved_by_staff_id: null,
    reverses_expense_id: original.id,
    reversal_reason: text,
    created_at: ctx.now.toISOString(),
    device_id: ctx.deviceId,
    server_seq: null,
  };
}

export interface ExpenseTotals {
  total_paisa: Paisa;
  byCategory: Map<string, Paisa>;
  byMethod: Map<string, Paisa>;
}

/** Totals for business dates from..to (inclusive), reversals netted out. */
export function expenseTotals(
  expenses: readonly Pick<
    ExpenseRow,
    'business_date' | 'category_id' | 'paid_method_code' | 'amount_paisa'
  >[],
  range: { from?: string; to?: string } = {},
): ExpenseTotals {
  const byCategory = new Map<string, Paisa>();
  const byMethod = new Map<string, Paisa>();
  let total = 0;
  for (const e of expenses) {
    if (range.from && e.business_date < range.from) continue;
    if (range.to && e.business_date > range.to) continue;
    total += e.amount_paisa;
    byCategory.set(e.category_id, (byCategory.get(e.category_id) ?? 0) + e.amount_paisa);
    byMethod.set(e.paid_method_code, (byMethod.get(e.paid_method_code) ?? 0) + e.amount_paisa);
  }
  // A category or method whose expenses were all reversed nets to 0: leave it out.
  for (const map of [byCategory, byMethod]) for (const [k, v] of map) if (v === 0) map.delete(k);
  return { total_paisa: total, byCategory, byMethod };
}
