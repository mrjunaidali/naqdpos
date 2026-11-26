// Expenses on the device (US065, US046, US066): read from Dexie, write through the outbox.
import {
  buildExpense,
  buildReversal,
  businessDate,
  uuidv7,
  type ExpenseCategoryRow,
  type ExpenseRow,
  type StaffRow,
} from '@naqdpos/core';
import { isShopSuspended } from '../../app/suspension.ts';
import { useRetryingLiveQuery } from '../../db/retry.ts';
import type { TFunction } from 'i18next';
import { localWriteMany } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { shopClosedDates } from '../closing/closedDates.ts';

export class ExpenseNotSaved extends Error {
  constructor(readonly reason: string) {
    super(`Expense not saved: ${reason}`);
    this.name = 'ExpenseNotSaved';
  }
}

/** Seeded defaults show through i18n (until renamed); owner-typed names as typed. */
export function categoryName(
  c: Pick<ExpenseCategoryRow, 'name' | 'name_ur' | 'i18n_key'>,
  t: TFunction,
  lang: string,
): string {
  if (c.i18n_key) return t(c.i18n_key);
  return lang === 'ur' && c.name_ur ? c.name_ur : c.name;
}

export function useExpenseCategories(): ExpenseCategoryRow[] | undefined {
  return useRetryingLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    return (await db.expense_categories.where('shop_id').equals(device.shop_id).toArray())
      .filter((c) => c.deleted_at === null)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  });
}

export function useExpenses(): ExpenseRow[] | undefined {
  return useRetryingLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    return db.expenses.where('shop_id').equals(device.shop_id).toArray();
  });
}

async function shopContext() {
  const device = await getStoredDevice();
  if (!device) throw new ExpenseNotSaved('no_device');
  const shop = await db.shops.get(device.shop_id);
  return { device, limitPaisa: shop?.cashier_expense_limit_paisa ?? 200_000 };
}

export async function expenseLimit(): Promise<number> {
  return (await shopContext()).limitPaisa;
}

// --- Categories (owner) ---

const saveCategories = (rows: ExpenseCategoryRow[], actor: string) =>
  localWriteMany(
    rows.map((row) => ({
      table: 'expense_categories' as const,
      op: 'upsert' as const,
      row: { ...row },
    })),
    db,
    { actorStaffId: actor },
  );

export async function addCategory(name: string, nameUr: string, actor: string) {
  const { device } = await shopContext();
  const all = await db.expense_categories.where('shop_id').equals(device.shop_id).toArray();
  const now = new Date().toISOString();
  const row: ExpenseCategoryRow = {
    id: uuidv7(),
    shop_id: device.shop_id,
    name: name.trim(),
    name_ur: nameUr.trim() || null,
    i18n_key: null,
    icon: null,
    sort: Math.max(0, ...all.map((c) => c.sort)) + 1,
    archived_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    device_id: device.id,
    server_seq: null,
  };
  await saveCategories([row], actor);
  return row;
}

/** Renaming a default drops its i18n key: the owner's names show from then on. */
export async function renameCategory(
  c: ExpenseCategoryRow,
  name: string,
  nameUr: string,
  actor: string,
) {
  await saveCategories(
    [
      {
        ...c,
        name: name.trim(),
        name_ur: nameUr.trim() || null,
        i18n_key: null,
        updated_at: new Date().toISOString(),
      },
    ],
    actor,
  );
}

export async function setCategoryArchived(c: ExpenseCategoryRow, archived: boolean, actor: string) {
  const now = new Date().toISOString();
  await saveCategories([{ ...c, archived_at: archived ? now : null, updated_at: now }], actor);
}

/** Swaps a category with its neighbour (sort numbers 1..n so the order is stable). */
export async function moveCategory(
  list: readonly ExpenseCategoryRow[],
  index: number,
  delta: -1 | 1,
  actor: string,
) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const order = [...list];
  [order[index], order[target]] = [order[target]!, order[index]!];
  const now = new Date().toISOString();
  const changed = order
    .map((c, i) => ({ ...c, sort: i + 1 }))
    .filter((c, i) => list.find((o) => o.id === c.id)?.sort !== i + 1)
    .map((c) => ({ ...c, updated_at: now }));
  if (changed.length) await saveCategories(changed, actor);
}

// --- Expenses ---

export async function addExpense(
  input: {
    categoryId: string;
    amountPaisa: number;
    methodCode: string;
    note?: string | null;
    payee?: string | null;
  },
  staff: StaffRow,
  approvedByStaffId: string | null,
): Promise<ExpenseRow> {
  const { device, limitPaisa } = await shopContext();
  if (await isShopSuspended()) throw new ExpenseNotSaved('shop_suspended');
  const built = buildExpense(input, {
    shopId: device.shop_id,
    deviceId: device.id,
    staffId: staff.id,
    role: staff.role,
    now: new Date(),
    limitPaisa,
    approvedByStaffId,
    closedDates: await shopClosedDates(),
  });
  if ('error' in built) throw new ExpenseNotSaved(built.error);
  await localWriteMany([{ table: 'expenses', op: 'insert', row: { ...built } }], db, {
    actorStaffId: staff.id,
  });
  return built;
}

export async function reverseExpense(original: ExpenseRow, reason: string, owner: StaffRow) {
  const { device } = await shopContext();
  if (await isShopSuspended()) throw new ExpenseNotSaved('shop_suspended');
  const all = await db.expenses.where('shop_id').equals(device.shop_id).toArray();
  const built = buildReversal(original, all, reason, {
    shopId: device.shop_id,
    deviceId: device.id,
    staffId: owner.id,
    role: owner.role,
    now: new Date(),
    closedDates: await shopClosedDates(),
  });
  if ('error' in built) throw new ExpenseNotSaved(built.error);
  await localWriteMany([{ table: 'expenses', op: 'insert', row: { ...built } }], db, {
    actorStaffId: owner.id,
  });
  return built;
}

/** The plain local date (for "today's" lists). */
export const today = () => businessDate(new Date());
