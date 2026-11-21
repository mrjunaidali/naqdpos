import { businessDate, type ExpenseCategoryRow, type ExpenseRow } from '@naqdpos/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { useCurrentStaffStore, writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const RIDER = '019a9b8e-0000-7000-8000-0000000000c3';
const RENT = '019a9b8e-0000-7000-8000-0000000000e1';
const ICE = '019a9b8e-0000-7000-8000-0000000000e2';
const NOW = new Date().toISOString();

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

const category = (id: string, over: Partial<ExpenseCategoryRow>): ExpenseCategoryRow => ({
  id,
  shop_id: SHOP_ID,
  name: 'x',
  name_ur: null,
  i18n_key: null,
  icon: null,
  sort: 1,
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  device_id: null,
  server_seq: 1,
  ...over,
});

let n = 0;
async function putExpense(over: Partial<ExpenseRow>) {
  n += 1;
  const row: ExpenseRow = {
    id: `019a9b8e-0000-7000-8000-${String(n).padStart(12, '0')}`,
    shop_id: SHOP_ID,
    business_date: businessDate(new Date()),
    category_id: RENT,
    amount_paisa: 50_000,
    paid_method_code: 'cash',
    note: null,
    payee: null,
    payee_staff_id: null,
    staff_id: STAFF_ID,
    approved_by_staff_id: null,
    reverses_expense_id: null,
    reversal_reason: null,
    recurring_expense_id: null,
    created_at: NOW,
    device_id: null,
    server_seq: n,
    ...over,
  };
  await db.expenses.put(row);
  return row;
}

async function seedShop(mode: 'owner' | 'shop' = 'owner') {
  await seedReady(mode);
  await db.staff.bulkPut([
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
    staffRow({ id: RIDER, name: 'Rafiq', role: 'rider', membership_user_id: null }),
  ]);
  await seedPin(STAFF_ID, '4821');
  await db.expense_categories.bulkPut([
    category(RENT, { name: 'Rent', i18n_key: 'expense.cat.rent', sort: 1 }),
    category(ICE, { name: 'Ice', name_ur: 'برف', sort: 2, archived_at: NOW }),
  ]);
  await db.outbox.clear();
}

const amount = (v: string) =>
  fireEvent.change(screen.getByLabelText('Amount (Rs)'), { target: { value: v } });

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  setOnline(true);
});

describe('categories (US065)', () => {
  it('an archived category is hidden for new expenses but still shown on old ones', async () => {
    await seedShop();
    const old = await putExpense({ category_id: ICE });
    renderAt('/expenses/new');
    expect(await screen.findByRole('button', { name: 'Rent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ice' })).toBeNull();
    renderAt(`/expenses/${old.id}`);
    expect(await screen.findByRole('heading', { name: 'Ice' })).toBeInTheDocument();
  });

  it('asks a cashier for the owner PIN', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    renderAt('/settings/expense-categories');
    expect(await screen.findByRole('heading', { name: 'Owner PIN needed' })).toBeInTheDocument();
  });

  it('the owner adds, renames, reorders and archives / restores', async () => {
    await seedShop();
    renderAt('/settings/expense-categories');
    fireEvent.change(await screen.findByLabelText('Name (English)'), { target: { value: 'Tea' } });
    fireEvent.change(screen.getByLabelText('Name (Urdu, optional)'), { target: { value: 'چائے' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(async () => expect(await db.expense_categories.count()).toBe(3));
    const tea = (await db.expense_categories.toArray()).find((c) => c.name === 'Tea')!;
    expect(tea).toMatchObject({ name_ur: 'چائے', i18n_key: null, sort: 3 });

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Rent' }));
    fireEvent.change(screen.getByLabelText('Name (English)'), { target: { value: 'Shop rent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(async () =>
      expect(await db.expense_categories.get(RENT)).toMatchObject({
        name: 'Shop rent',
        i18n_key: null,
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Move Tea up' }));
    await waitFor(async () => expect((await db.expense_categories.get(tea.id))?.sort).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Archive Tea' }));
    await waitFor(async () =>
      expect((await db.expense_categories.get(tea.id))?.archived_at).not.toBeNull(),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Ice' }));
    await waitFor(async () =>
      expect((await db.expense_categories.get(ICE))?.archived_at).toBeNull(),
    );
    expect((await db.outbox.toArray()).every((e) => e.actor_staff_id === STAFF_ID)).toBe(true);
  });
});

describe('add expense (US046)', () => {
  it('a cashier within the limit saves offline with no PIN', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    setOnline(false);
    const { router } = renderAt('/expenses/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Rent' }));
    amount('500');
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'bags' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/expenses'));
    expect(await screen.findByText('Saved offline — will sync when online')).toBeInTheDocument();
    const [e] = await db.expenses.toArray();
    expect(e).toMatchObject({
      amount_paisa: 50_000,
      staff_id: CASHIER,
      note: 'bags',
      approved_by_staff_id: null,
    });
    expect((await db.outbox.toArray())[0]).toMatchObject({
      table: 'expenses',
      actor_staff_id: CASHIER,
    });
    expect(vi.mocked(api.syncPush)).not.toHaveBeenCalled();
  });

  it('a cashier above the limit needs the owner PIN; the approver is stored', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    const { router } = renderAt('/expenses/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Rent' }));
    amount('2500'); // limit Rs 2,000
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    const pin = await screen.findByRole('dialog', { name: 'Owner PIN needed' });
    expect(await db.expenses.count()).toBe(0);
    for (const d of '4821') fireEvent.click(await within(pin).findByRole('button', { name: d }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/expenses'));
    expect((await db.expenses.toArray())[0]).toMatchObject({
      amount_paisa: 250_000,
      staff_id: CASHIER,
      approved_by_staff_id: STAFF_ID,
    });
  });

  it('riders cannot add expenses', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(RIDER);
    renderAt('/expenses/new');
    expect(await screen.findByText('Riders cannot add expenses.')).toBeInTheDocument();
    renderAt('/expenses');
    await screen.findByText("Today's expenses");
    expect(screen.queryByRole('link', { name: 'Add expense' })).toBeNull();
  });
});

describe('list and reversal (US066)', () => {
  it('a cashier sees only their own expenses for today; the owner sees all', async () => {
    await seedShop('shop');
    await putExpense({ staff_id: STAFF_ID, amount_paisa: 10_000 });
    await putExpense({ staff_id: CASHIER, amount_paisa: 20_000 });
    await putExpense({ staff_id: CASHIER, amount_paisa: 40_000, business_date: '2020-01-01' });
    await writeCurrentStaffId(CASHIER);
    renderAt('/expenses');
    expect(await screen.findByText('Rs 200', { selector: '.text-3xl' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    // The owner switches in (PIN switch): the list now shows everyone's expenses.
    await act(() => useCurrentStaffStore.getState().switchTo(STAFF_ID));
    expect(await screen.findByText('Rs 300', { selector: '.text-3xl' })).toBeInTheDocument();
  });

  it('the owner reverses once, with a reason; the original shows Reversed', async () => {
    await seedShop();
    await writeCurrentStaffId(STAFF_ID);
    const e = await putExpense({ amount_paisa: 30_000 });
    renderAt(`/expenses/${e.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Reverse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse Rs 300' }));
    expect(await screen.findByText('A reason is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'typed twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse Rs 300' }));
    expect(await screen.findByText('Reversed: typed twice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).toBeNull();
    const rev = (await db.expenses.toArray()).find((x) => x.reverses_expense_id === e.id)!;
    expect(rev).toMatchObject({
      amount_paisa: -30_000,
      reversal_reason: 'typed twice',
      staff_id: STAFF_ID,
    });

    renderAt(`/expenses/${rev.id}`);
    expect(
      await screen.findByRole('link', { name: 'See the original expense' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).toBeNull();
    renderAt('/expenses');
    expect(await screen.findByText('Reversed')).toBeInTheDocument();
    expect(screen.getByText('Rs 0', { selector: '.text-3xl' })).toBeInTheDocument();
  });

  it('cashiers get no Reverse button', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    const e = await putExpense({ staff_id: CASHIER });
    renderAt(`/expenses/${e.id}`);
    await screen.findByText('Added by');
    expect(screen.queryByRole('button', { name: 'Reverse' })).toBeNull();
  });
});

describe('limit setting', () => {
  it('the owner sets the cashier expense limit in Settings → Shop', async () => {
    await seedShop();
    const { router } = renderAt('/settings/shop');
    fireEvent.change(await screen.findByLabelText('Cashier expense limit (Rs)'), {
      target: { value: '3000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect((await db.shops.get(SHOP_ID))?.cashier_expense_limit_paisa).toBe(300_000);
  });
});
