import { FRESH_PRODUCE, makeLine, type CartLine } from '@naqdpos/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/schema.ts';
import { resetApiMock } from '../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID } from '../test/fixtures.ts';
import { renderAt } from '../test/render.tsx';
import { createFromPresets } from '../features/catalogue/catalogueRepo.ts';
import { addExpense } from '../features/expenses/expenseRepo.ts';
import { findOrAddCustomer, receiveKhataPayment } from '../features/khata/khataRepo.ts';
import { useCartStore } from '../features/sale/cartStore.ts';
import { completeSale } from '../features/sale/completeSale.ts';

vi.mock('../api/index.ts', () => import('../test/apiMock.ts'));
vi.mock('../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

async function setStatus(status: 'active' | 'suspended') {
  const shop = (await db.shops.get(SHOP_ID))!;
  // As pulled from the server after an admin's change.
  await db.shops.put({
    ...shop,
    status,
    suspended_at: status === 'suspended' ? new Date().toISOString() : null,
  });
}

async function putTomatoes() {
  const p = (await db.products.toArray())[0]!;
  useCartStore.getState().put(
    makeLine(
      {
        product_id: p.id,
        name: p.name,
        name_ur: null,
        unit: 'kg',
        icon: null,
        unit_price_paisa: 16500,
      },
      1300,
    ) as CartLine,
  );
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  useCartStore.setState({
    lines: [],
    billDiscount: null,
    approval: null,
    customerId: null,
    ready: true,
  });
  await seedReady('owner');
  await seedPin(STAFF_ID, '4821');
  await createFromPresets(
    [{ preset: FRESH_PRODUCE.find((x) => x.key === 'tomato')!, rate: 16500 }],
    STAFF_ID,
  );
  await db.expense_categories.put({
    id: '019a9b8e-0000-7000-8000-0000000000e1',
    shop_id: SHOP_ID,
    name: 'Rent',
    name_ur: null,
    i18n_key: null,
    icon: null,
    sort: 1,
    archived_at: null,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    device_id: null,
    server_seq: 1,
  });
});

describe('suspended shop (US011)', () => {
  it('shows the red banner; blocks sale, khata and expense; existing data stays viewable', async () => {
    await putTomatoes();
    const before = await completeSale([
      { method_code: 'cash', amount_paisa: 21_500, reference: null },
    ]);
    const customer = await findOrAddCustomer('03001234567', 'Ali', STAFF_ID);
    await setStatus('suspended');

    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This shop is suspended — contact NaqdPOS support',
    );

    await putTomatoes();
    await expect(
      completeSale([{ method_code: 'cash', amount_paisa: 21_500, reference: null }]),
    ).rejects.toMatchObject({
      reason: 'shop_suspended',
    });
    const owner = (await db.staff.get(STAFF_ID))!;
    await expect(receiveKhataPayment(customer, 10_000, 'cash', null, owner)).rejects.toMatchObject({
      reason: 'shop_suspended',
    });
    await expect(
      addExpense(
        {
          categoryId: '019a9b8e-0000-7000-8000-0000000000e1',
          amountPaisa: 100,
          methodCode: 'cash',
        },
        owner,
        null,
      ),
    ).rejects.toMatchObject({ reason: 'shop_suspended' });
    expect(await db.sales.count()).toBe(1);

    renderAt(`/sales/${before.sale.id}`);
    expect(await screen.findByText(before.sale.receipt_no)).toBeInTheDocument();
  });

  it('the pay screen says why the sale cannot be completed', async () => {
    await setStatus('suspended');
    await putTomatoes();
    renderAt('/sale/pay');
    fireEvent.click(await screen.findByRole('button', { name: 'Exact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete sale' }));
    expect(
      await screen.findByText(
        'This shop is suspended: new sales, khata and expenses are paused. Contact NaqdPOS support.',
      ),
    ).toBeInTheDocument();
  });

  it('reactivating restores selling and removes the banner', async () => {
    await setStatus('suspended');
    await setStatus('active');
    await putTomatoes();
    await expect(
      completeSale([{ method_code: 'cash', amount_paisa: 21_500, reference: null }]),
    ).resolves.toBeTruthy();
    renderAt('/');
    await screen.findByText("Today's sales");
    expect(screen.queryByText(/This shop is suspended/)).toBeNull();
  });

  it('Settings → Shop saves the city', async () => {
    const { router } = renderAt('/settings/shop');
    fireEvent.change(await screen.findByLabelText('City'), { target: { value: 'Lahore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect((await db.shops.get(SHOP_ID))?.city).toBe('Lahore');
  });
});
