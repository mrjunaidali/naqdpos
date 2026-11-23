import {
  customerId,
  FRESH_PRODUCE,
  makeLine,
  type CartLine,
  type KhataEntryRow,
} from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { createFromPresets } from '../catalogue/catalogueRepo.ts';
import { useCartStore } from '../sale/cartStore.ts';
import { completeSale } from '../sale/completeSale.ts';
import { findOrAddCustomer } from './khataRepo.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const ALI = '+923001234567';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

async function seedShop(mode: 'owner' | 'shop' = 'owner') {
  await seedReady(mode);
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await seedPin(CASHIER, '1234');
  await createFromPresets(
    [{ preset: FRESH_PRODUCE.find((p) => p.key === 'tomato')!, rate: 16500 }],
    STAFF_ID,
  );
  await db.outbox.clear();
}

/** 1.3 kg tomatoes at Rs 165 = Rs 214.50 → bill Rs 215. */
async function putTomatoes() {
  const p = (await db.products.toArray())[0]!;
  useCartStore.getState().put(
    makeLine(
      {
        product_id: p.id,
        name: p.name,
        name_ur: p.name_ur,
        unit: p.unit,
        icon: null,
        unit_price_paisa: p.sale_price_paisa,
      },
      1300,
    ) as CartLine,
  );
}

let entryN = 0;
async function entry(customer: string, amount: number, date: string, type: KhataEntryRow['type']) {
  entryN += 1;
  await db.khata_entries.put({
    id: `019a9b8e-0000-7000-8000-${String(entryN).padStart(12, '0')}`,
    shop_id: SHOP_ID,
    customer_id: customer,
    business_date: date,
    type,
    amount_paisa: amount,
    sale_id: null,
    payment_id: null,
    note: null,
    staff_id: STAFF_ID,
    created_at: `${date}T10:00:00.000Z`,
    device_id: null,
    server_seq: entryN,
  });
}

const pad = (text: string) => {
  for (const key of text) fireEvent.click(screen.getByRole('button', { name: key }));
};

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  setOnline(true);
  useCartStore.setState({
    lines: [],
    billDiscount: null,
    approval: null,
    customerId: null,
    ready: true,
  });
});

describe('customers (US038)', () => {
  it('the same mobile gives the same customer, on any device, in any format', async () => {
    await seedShop();
    const a = await findOrAddCustomer('0300 1234567', 'Ali', STAFF_ID);
    const b = await findOrAddCustomer('+92 300-1234567', null, CASHIER);
    expect(b.id).toBe(a.id);
    // Another device computes the id on its own: same shop + mobile = same id.
    expect(await customerId(SHOP_ID, '923001234567')).toBe(a.id);
    expect(await db.customers.count()).toBe(1);
    expect(b.name).toBe('Ali');
    expect((await db.outbox.toArray()).map((e) => e.table)).toEqual(['customers']);
  });

  it('the customer chip adds a customer offline and shows the balance when picked', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    setOnline(false);
    renderAt('/sale');
    const chip = await screen.findByRole('button', { name: 'Customer' });
    await waitFor(() => expect(chip).toBeEnabled());
    fireEvent.click(chip);
    fireEvent.click(await screen.findByRole('button', { name: 'Add new customer' }));
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0300 1234567' } });
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Ali' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('Ali')).toBeInTheDocument();
    const id = useCartStore.getState().customerId!;
    expect((await db.customers.get(id))?.mobile).toBe(ALI);

    await entry(id, 50000, '2026-11-01', 'adjustment');
    expect(await screen.findByText('owes Rs 500')).toBeInTheDocument();
    expect(vi.mocked(api.syncPush)).not.toHaveBeenCalled();
  });

  it('refuses a number that is not a Pakistani mobile', async () => {
    await seedShop();
    renderAt('/sale');
    const chip = await screen.findByRole('button', { name: 'Customer' });
    await waitFor(() => expect(chip).toBeEnabled());
    fireEvent.click(chip);
    fireEvent.click(await screen.findByRole('button', { name: 'Add new customer' }));
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '042 1234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(
      await screen.findByText('Enter a Pakistani mobile number, e.g. 0300 1234567.'),
    ).toBeInTheDocument();
    expect(await db.customers.count()).toBe(0);
  });
});

describe('sale on khata (US039)', () => {
  it('Khata / Udhaar is always shown; without a customer it opens the picker, then applies', async () => {
    await seedShop();
    await putTomatoes();
    setOnline(false);
    const { router } = renderAt('/sale/pay');
    fireEvent.click(await screen.findByRole('button', { name: 'Khata / Udhaar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add new customer' }));
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0300 1234567' } });
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Ali' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('Customer: Ali')).toBeInTheDocument();
    // The khata method is chosen with what is due; completing puts the bill on khata.
    fireEvent.click(await screen.findByRole('button', { name: 'Complete sale' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/sale\/done\//));
    const [credit] = await db.khata_entries.toArray();
    expect(credit).toMatchObject({ type: 'credit_sale', amount_paisa: 21500 });
    expect(vi.mocked(api.syncPush)).not.toHaveBeenCalled();
  });

  it('removing the customer on the pay screen removes the khata part', async () => {
    await seedShop();
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    await putTomatoes();
    useCartStore.getState().setCustomer(c.id);
    renderAt('/sale/pay');
    await screen.findByRole('button', { name: 'Exact' });
    pad('100');
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    // Khata for Rs 50 of the Rs 115 left (the keypad starts with what is due).
    fireEvent.click(await screen.findByRole('button', { name: 'Khata / Udhaar' }));
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    }
    pad('50');
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    expect(await screen.findByText('Khata (Ali)')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove customer' }));
    expect(useCartStore.getState().customerId).toBeNull();
    expect(screen.queryByText(/^Khata \(/)).toBeNull();
    expect(await screen.findByText('Remaining Rs 115')).toBeInTheDocument();
  });

  it('the whole bill on khata: one credit_sale entry, no payment, new balance shown', async () => {
    await seedShop();
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    await entry(c.id, 100000, '2026-11-01', 'adjustment'); // already owes Rs 1,000
    await putTomatoes();
    useCartStore.getState().setCustomer(c.id);
    const { router } = renderAt('/sale/pay');
    fireEvent.click(await screen.findByRole('button', { name: 'Khata / Udhaar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete sale' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/sale\/done\//));
    expect(await screen.findByText('On khata: Rs 215')).toBeInTheDocument();
    expect(await screen.findByText('New balance: Rs 1,215')).toBeInTheDocument();

    const [sale] = await db.sales.toArray();
    expect(sale?.customer_id).toBe(c.id);
    expect(await db.payments.count()).toBe(0);
    const credit = (await db.khata_entries.toArray()).find((e) => e.type === 'credit_sale');
    expect(credit).toMatchObject({ amount_paisa: 21500, sale_id: sale?.id, customer_id: c.id });
    const tables = (await db.outbox.orderBy('id').toArray()).map((e) => e.table);
    expect(tables.indexOf('customers')).toBeLessThan(tables.indexOf('sales'));
    expect(tables.indexOf('sales')).toBeLessThan(tables.indexOf('khata_entries'));
  });

  it('part cash, part khata: payments + khata = total', async () => {
    await seedShop();
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    await putTomatoes();
    useCartStore.getState().setCustomer(c.id);
    const { router } = renderAt('/sale/pay');
    await screen.findByRole('button', { name: 'Exact' });
    pad('100');
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Khata / Udhaar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete sale' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/sale\/done\//));
    const [payment] = await db.payments.toArray();
    const [credit] = await db.khata_entries.toArray();
    expect([payment?.amount_paisa, credit?.amount_paisa]).toEqual([10000, 11500]);
    expect(payment?.customer_id).toBe(c.id);
  });

  it('a failed write leaves nothing: sale and khata entry are one transaction', async () => {
    await seedShop();
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    await db.outbox.clear();
    await putTomatoes();
    useCartStore.getState().setCustomer(c.id);
    const realAdd = db.outbox.add.bind(db.outbox);
    const spy = vi.spyOn(db.outbox, 'add');
    spy.mockImplementationOnce(realAdd).mockImplementationOnce(realAdd);
    spy.mockImplementationOnce((() =>
      Promise.reject(new Error('disk full'))) as unknown as typeof db.outbox.add);
    await expect(completeSale([], { khataPaisa: 21500 })).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await db.sales.count()).toBe(0);
    expect(await db.khata_entries.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('receive payment (US040)', () => {
  it('writes the payment and the negative entry, and offers a WhatsApp receipt', async () => {
    await seedShop();
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    await entry(c.id, 170000, '2026-11-01', 'adjustment');
    await db.outbox.clear();
    renderAt(`/khata/${c.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Receive payment' }));
    const sheet = await screen.findByRole('dialog', { name: 'Receive payment' });
    fireEvent.change(within(sheet).getByLabelText('Amount (Rs)'), { target: { value: '500' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save payment' }));

    const share = await screen.findByRole('link', { name: 'Share on WhatsApp' });
    expect(share.getAttribute('href')).toBe(
      `https://wa.me/923001234567?text=${encodeURIComponent('Rs 500 received. New balance Rs 1,200. — Ali Fruit')}`,
    );
    const [payment] = await db.payments.toArray();
    expect(payment).toMatchObject({
      kind: 'khata_receipt',
      customer_id: c.id,
      amount_paisa: 50000,
    });
    const back = (await db.khata_entries.toArray()).find((e) => e.type === 'payment');
    expect(back).toMatchObject({ amount_paisa: -50000, payment_id: payment?.id });
    expect((await db.outbox.toArray()).map((e) => e.table)).toEqual(['payments', 'khata_entries']);
  });
});

/**
 * Opens Add customer on the khata list. The list re-renders while its live queries settle, so a
 * button found by an earlier render can be detached when clicked: retry until the form shows.
 */
async function openAddCustomer() {
  await waitFor(() => {
    if (!screen.queryByLabelText('Mobile number'))
      fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
  });
}

describe('add customer and opening balance (US080)', () => {
  it('Khata → Add customer saves the customer and opens their page; an existing mobile opens it', async () => {
    await seedShop();
    const { router } = renderAt('/khata');
    await openAddCustomer();
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0300 1234567' } });
    fireEvent.change(screen.getByLabelText('Address (optional)'), {
      target: { value: 'Street 5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    const id = await customerId(SHOP_ID, ALI);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/khata/${id}`));
    expect((await db.customers.get(id!))?.address).toBe('Street 5');

    await router.navigate('/khata');
    await openAddCustomer();
    fireEvent.change(screen.getByLabelText('Mobile number'), {
      target: { value: '+92 300 1234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/khata/${id}`));
    expect(await db.customers.count()).toBe(1);
  });

  it('the owner adds a customer with an opening balance: one adjustment, list updated', async () => {
    await seedShop();
    await writeCurrentStaffId(STAFF_ID);
    const { router } = renderAt('/khata');
    await openAddCustomer();
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0300 1234567' } });
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Ali' } });
    fireEvent.change(screen.getByLabelText('Opening balance (from your paper khata)'), {
      target: { value: '1200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/khata\/.+/));
    const entries = await db.khata_entries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'adjustment',
      amount_paisa: 120000,
      note: 'Opening balance',
      staff_id: STAFF_ID,
    });
    await waitFor(() =>
      expect(screen.getByText('Rs 1,200', { selector: '.text-3xl' })).toBeInTheDocument(),
    );
    await router.navigate('/khata');
    // The list re-renders as its live queries settle: check inside waitFor, not on a node found
    // by an earlier render (it can be replaced before the assertion runs).
    await waitFor(() => {
      expect(screen.getByText('Total receivable')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Call Ali' })).toBeInTheDocument();
    });
  });

  it('a cashier entering an opening balance is asked for the owner PIN', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    renderAt('/khata');
    await openAddCustomer();
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0300 1234567' } });
    fireEvent.change(screen.getByLabelText('Opening balance (from your paper khata)'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    const pin = await screen.findByRole('dialog', { name: 'Owner PIN needed' });
    expect(await db.customers.count()).toBe(0);
    for (const d of '4821') fireEvent.click(await within(pin).findByRole('button', { name: d }));
    await waitFor(async () => expect(await db.khata_entries.count()).toBe(1));
    expect((await db.khata_entries.toArray())[0]).toMatchObject({
      amount_paisa: 50000,
      note: 'Opening balance',
      staff_id: STAFF_ID,
    });
    expect((await db.outbox.toArray()).at(-1)?.actor_staff_id).toBe(STAFF_ID);
  });

  it('the customer page offers Opening balance only while the customer has no entries', async () => {
    await seedShop();
    await writeCurrentStaffId(STAFF_ID);
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    renderAt(`/khata/${c.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Opening balance' }));
    const sheet = await screen.findByRole('dialog', { name: 'Opening balance' });
    fireEvent.change(within(sheet).getByLabelText('Amount (Rs)'), { target: { value: '750' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save opening balance' }));
    expect(await screen.findByText('Rs 750', { selector: '.text-3xl' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opening balance' })).toBeNull();
    expect((await db.khata_entries.toArray())[0]).toMatchObject({
      type: 'adjustment',
      note: 'Opening balance',
      amount_paisa: 75000,
    });
  });
});

describe('khata list and ledger (US041)', () => {
  it('sorted by balance, total receivable, overdue filter and search', async () => {
    await seedShop();
    const ali = await findOrAddCustomer('03001111111', 'Ali', STAFF_ID);
    const sara = await findOrAddCustomer('03002222222', 'Sara', STAFF_ID);
    const zero = await findOrAddCustomer('03003333333', 'Zain', STAFF_ID);
    await entry(ali.id, 50000, '2026-01-01', 'adjustment'); // old, never paid → overdue
    await entry(sara.id, 120000, new Date().toISOString().slice(0, 10), 'adjustment');
    await entry(zero.id, 1000, '2026-01-01', 'adjustment');
    await entry(zero.id, -1000, '2026-01-02', 'adjustment');

    renderAt('/khata');
    expect(await screen.findByText('Rs 1,700')).toBeInTheDocument();
    const names = () =>
      within(screen.getByRole('list'))
        .getAllByRole('link')
        .filter((l) => l.getAttribute('href')?.startsWith('/khata/'))
        .map((l) => l.textContent);
    expect(names()).toEqual(['Sara0300 2222222', 'Ali0300 1111111']);
    expect(screen.queryByText('Zain')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Overdue only' }));
    expect(names()).toEqual(['Ali0300 1111111']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Overdue only' }));

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '0300 222' } });
    expect(names()).toEqual(['Sara0300 2222222']);
    expect(screen.getByRole('link', { name: 'Call Sara' }).getAttribute('href')).toBe(
      'tel:+923002222222',
    );
    expect(screen.getByRole('link', { name: 'WhatsApp Sara' }).getAttribute('href')).toBe(
      'https://wa.me/923002222222',
    );
  });

  it('the ledger shows a running balance and links sales', async () => {
    await seedShop();
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    await putTomatoes();
    useCartStore.getState().setCustomer(c.id);
    const rows = await completeSale([], { khataPaisa: 21500 });
    await entry(c.id, -5000, '2099-01-01', 'adjustment');
    renderAt(`/khata/${c.id}`);
    const link = await screen.findByRole('link', { name: 'Sale on khata' });
    expect(link.getAttribute('href')).toBe(`/sales/${rows.sale.id}`);
    expect(screen.getByText('Balance Rs 215')).toBeInTheDocument();
    expect(screen.getByText('Balance Rs 165')).toBeInTheDocument();
  });

  it('adjust balance: a cashier is asked for the owner PIN; the note is required', async () => {
    await seedShop('shop');
    const c = await findOrAddCustomer(ALI, 'Ali', STAFF_ID);
    await writeCurrentStaffId(CASHIER);
    renderAt(`/khata/${c.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust balance' }));
    const pin = await screen.findByRole('dialog', { name: 'Owner PIN needed' });
    for (const d of '4821') fireEvent.click(await within(pin).findByRole('button', { name: d }));
    const sheet = await screen.findByRole('dialog', { name: 'Adjust balance' });
    fireEvent.change(within(sheet).getByLabelText('Amount (Rs)'), { target: { value: '20' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save adjustment' }));
    expect(await within(sheet).findByText('A note is required.')).toBeInTheDocument();
    expect(await db.khata_entries.count()).toBe(0);

    fireEvent.change(within(sheet).getByLabelText('Note (required)'), {
      target: { value: 'old balance' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save adjustment' }));
    await waitFor(async () => expect(await db.khata_entries.count()).toBe(1));
    expect((await db.khata_entries.toArray())[0]).toMatchObject({
      type: 'adjustment',
      amount_paisa: -2000,
      note: 'old balance',
      staff_id: STAFF_ID,
    });
    expect((await db.outbox.toArray()).at(-1)?.actor_staff_id).toBe(STAFF_ID);
  });
});
