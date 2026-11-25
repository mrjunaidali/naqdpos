import { FRESH_PRODUCE, makeLine, type CartLine, type ProductRow } from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { createFromPresets } from '../catalogue/catalogueRepo.ts';
import { saveDiscountLimit } from '../settings/discountLimit.ts';
import { CART_KEY, useCartStore } from './cartStore.ts';
import { completeSale } from './completeSale.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const preset = (key: string) => FRESH_PRODUCE.find((p) => p.key === key)!;
const product = async (name: string) => (await db.products.toArray()).find((p) => p.name === name)!;

/** Tomato Rs 165/kg, Coriander Rs 40/bundle (free from Rs 200, tracked), Potato Rs 80/kg. */
async function seedShop(as: 'cashier' | 'owner' = 'cashier') {
  await seedReady('shop');
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await seedPin(CASHIER, '1234');
  await createFromPresets(
    [
      { preset: preset('tomato'), rate: 16500 },
      { preset: preset('coriander'), rate: 4000, focFree: true },
      { preset: preset('potato'), rate: 8000 },
    ],
    STAFF_ID,
  );
  const coriander = await product('Coriander');
  await db.products.put({ ...coriander, track_stock: true });
  await db.outbox.clear();
  await writeCurrentStaffId(as === 'cashier' ? CASHIER : STAFF_ID);
}

function line(p: ProductRow, qtyMilli: number, over: Partial<CartLine> = {}) {
  const made = makeLine(
    {
      product_id: p.id,
      name: p.name,
      name_ur: p.name_ur,
      unit: p.unit,
      icon: p.icon ?? null,
      unit_price_paisa: p.sale_price_paisa,
    },
    qtyMilli,
  ) as CartLine;
  const full = { ...made, ...over };
  useCartStore.getState().put(full);
  return full;
}

async function enterOwnerPin() {
  const pin = await screen.findByRole('dialog', { name: 'Owner PIN needed' });
  for (const d of '4821') fireEvent.click(await within(pin).findByRole('button', { name: d }));
}

const charge = async () => fireEvent.click(await screen.findByRole('button', { name: 'Charge' }));

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  useCartStore.setState({ lines: [], billDiscount: null, approval: null, ready: true });
});

describe('line discounts (US032)', () => {
  it('a % line discount shows as its own line and the total updates live', async () => {
    await seedShop();
    line(await product('Tomato'), 1300); // Rs 214.50
    renderAt('/sale');
    fireEvent.click(await screen.findByRole('button', { name: 'Open cart, 1 item' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discount on Tomato' }));
    const sheet = await screen.findByRole('dialog', { name: 'Discount — Tomato' });
    fireEvent.click(within(sheet).getByRole('button', { name: '%' }));
    for (const d of '10') fireEvent.click(within(sheet).getByRole('button', { name: d }));
    expect(within(sheet).getByText('Rs 21.45 off Rs 214.50')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply discount' }));

    const cart = await screen.findByRole('dialog', { name: 'Cart' });
    expect(within(cart).getByText('Discount 10%')).toBeInTheDocument();
    expect(within(cart).getByText('Rs 193.05', { selector: 'p span' })).toBeInTheDocument();
    expect(useCartStore.getState().lines[0]!.discount).toEqual({ kind: 'pct', value: 10 });
  });

  it('refuses a discount above the line', async () => {
    await seedShop();
    line(await product('Potato'), 1000); // Rs 80
    renderAt('/sale');
    fireEvent.click(await screen.findByRole('button', { name: 'Open cart, 1 item' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discount on Potato' }));
    const sheet = await screen.findByRole('dialog', { name: 'Discount — Potato' });
    for (const d of '81') fireEvent.click(within(sheet).getByRole('button', { name: d }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply discount' }));
    expect(
      await within(sheet).findByText('The discount is more than the amount.'),
    ).toBeInTheDocument();
    expect(useCartStore.getState().lines[0]!.discount).toBeNull();
  });
});

describe('cashier limit (10% by default)', () => {
  it('within the limit: Charge opens payment without a PIN', async () => {
    await seedShop();
    // Rs 20 of Rs 214.50 = 9.3%
    line(await product('Tomato'), 1300, { discount: { kind: 'rs', value: 2000 } });
    const { router } = renderAt('/sale');
    await charge();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale/pay'));
    expect(screen.queryByRole('dialog', { name: 'Owner PIN needed' })).toBeNull();
  });

  it('above the limit: owner PIN, the approver is stored, and giving more asks again', async () => {
    await seedShop();
    // Rs 30 off Rs 214.50 = 14%
    const tomato = line(await product('Tomato'), 1300, { discount: { kind: 'rs', value: 3000 } });
    const { router } = renderAt('/sale');
    await charge();
    expect(
      await screen.findByText('Discounts and free items above the cashier limit need the owner.'),
    ).toBeInTheDocument();
    await enterOwnerPin();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale/pay'));
    expect(useCartStore.getState().approval).toEqual({ staffId: STAFF_ID, give_away_paisa: 3000 });

    // More than the owner approved: asked again at Charge.
    useCartStore.getState().put({ ...tomato, discount: { kind: 'rs', value: 4000 } });
    await router.navigate('/sale');
    await charge();
    expect(await screen.findByRole('dialog', { name: 'Owner PIN needed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // Back to the approved amount: the sale records the owner.
    useCartStore.getState().put({ ...tomato, discount: { kind: 'rs', value: 3000 } });
    const rows = await completeSale([
      { method_code: 'cash', amount_paisa: 18500, reference: null },
    ]);
    expect(rows.sale.discount_approved_by_staff_id).toBe(STAFF_ID);
    expect((await db.sales.get(rows.sale.id))?.discount_approved_by_staff_id).toBe(STAFF_ID);
  });

  it('completeSale refuses a cashier above the limit without approval', async () => {
    await seedShop();
    line(await product('Tomato'), 1300, { discount: { kind: 'rs', value: 3000 } });
    await expect(
      completeSale([{ method_code: 'cash', amount_paisa: 18500, reference: null }]),
    ).rejects.toMatchObject({ reason: 'over_limit' });
    expect(await db.sales.count()).toBe(0);
  });

  it('the owner has no limit', async () => {
    await seedShop('owner');
    line(await product('Tomato'), 1300, { discount: { kind: 'pct', value: 50 } });
    const { router } = renderAt('/sale');
    await charge();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale/pay'));
    expect(screen.queryByRole('dialog', { name: 'Owner PIN needed' })).toBeNull();
  });

  it('the limit comes from the shop setting, which only the owner can change', async () => {
    await seedShop();
    await saveDiscountLimit(15, STAFF_ID);
    expect((await db.shops.get(SHOP_ID))?.cashier_max_discount_pct).toBe(15);
    expect((await db.outbox.toArray()).at(-1)).toMatchObject({
      table: 'shops',
      actor_staff_id: STAFF_ID,
    });
    // 14% is now within a cashier's limit.
    line(await product('Tomato'), 1300, { discount: { kind: 'rs', value: 3000 } });
    const rows = await completeSale([
      { method_code: 'cash', amount_paisa: 18500, reference: null },
    ]);
    expect(rows.sale.discount_approved_by_staff_id).toBeNull();

    renderAt('/settings/discount-limit');
    expect(await screen.findByRole('heading', { name: 'Owner PIN needed' })).toBeInTheDocument();
  });
});

describe('free items (US033)', () => {
  it('a free line pays 0, keeps its price and still moves stock', async () => {
    await seedShop('owner');
    const coriander = await product('Coriander');
    line(await product('Tomato'), 1300);
    line(coriander, 1000, { is_foc: true });
    const rows = await completeSale([
      { method_code: 'cash', amount_paisa: 21500, reference: null },
    ]);
    const free = rows.lines.find((l) => l.is_foc)!;
    expect(free).toMatchObject({ line_total_paisa: 0, unit_price_paisa: 4000, discount_paisa: 0 });
    expect(rows.sale.subtotal_paisa).toBe(21450);
    const [movement] = await db.stock_movements.toArray();
    expect(movement).toMatchObject({ product_id: coriander.id, qty_milli: -1000, reason: 'sale' });
  });

  it('the preset "Give free with purchases?" sets the suggested rule', async () => {
    await seedShop();
    expect((await product('Coriander')).foc_rule).toEqual({
      min_bill_paisa: 20000,
      qty_milli: 1000,
    });
    expect((await product('Potato')).foc_rule).toBeNull();
  });

  it('suggests a free item at the threshold; one tap adds it as FOC', async () => {
    await seedShop();
    line(await product('Tomato'), 1300); // Rs 214.50 ≥ Rs 200
    renderAt('/sale');
    fireEvent.click(await screen.findByRole('button', { name: 'Add free Coriander (1 bundle)?' }));
    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(2));
    expect(useCartStore.getState().lines[1]).toMatchObject({ name: 'Coriander', is_foc: true });
    expect(screen.queryByRole('button', { name: /Add free Coriander/ })).toBeNull();
    const tile = screen.getByText('Coriander').closest('button')!;
    expect(tile.className).toContain('border-dashed');
    expect(within(tile).getByText('FOC')).toBeInTheDocument();
  });

  it('no suggestion below the threshold or when the product is already in the cart', async () => {
    await seedShop();
    const tomato = line(await product('Tomato'), 1000); // Rs 165
    renderAt('/sale');
    await screen.findByRole('button', { name: 'Charge' });
    expect(screen.queryByRole('button', { name: /Add free/ })).toBeNull();
    useCartStore.getState().put({ ...tomato, qty_milli: 2000, line_total_paisa: 33000 });
    expect(await screen.findByRole('button', { name: /Add free Coriander/ })).toBeInTheDocument();
    line(await product('Coriander'), 1000); // paid coriander in the cart
    await waitFor(() => expect(screen.queryByRole('button', { name: /Add free/ })).toBeNull());
  });
});

describe('pay screen and receipt', () => {
  it('bill discount: live total, locked by a payment, unlocked when it is removed', async () => {
    await seedShop('owner');
    line(await product('Tomato'), 1300);
    renderAt('/sale/pay');
    fireEvent.click(await screen.findByRole('button', { name: 'Discount' }));
    const sheet = await screen.findByRole('dialog', { name: 'Bill discount' });
    fireEvent.click(within(sheet).getByRole('button', { name: '5' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply discount' }));
    // 21450 − 500 = 20950 → Rs 210
    const discount = { name: 'Discount −Rs 5' };
    await screen.findByRole('button', discount);
    expect(document.querySelector('[data-figure="total"] dd')).toHaveTextContent('Rs 210');

    // A part payment in cash (Rs 100 of Rs 210).
    fireEvent.click(screen.getByRole('button', { name: 'Add Rs 100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    expect(await screen.findByRole('button', discount)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this payment' }));
    expect(screen.getByRole('button', discount)).toBeEnabled();
  });

  it('the success screen shows item discounts, free items, the bill discount and approver', async () => {
    await seedShop();
    line(await product('Tomato'), 1300, { discount: { kind: 'rs', value: 1000 } });
    line(await product('Coriander'), 1000, { is_foc: true });
    useCartStore.getState().setBillDiscount({ kind: 'rs', value: 450 });
    useCartStore.getState().setApproval({ staffId: STAFF_ID, give_away_paisa: 5450 });
    const rows = await completeSale([
      { method_code: 'cash', amount_paisa: 20000, reference: null },
    ]);
    renderAt(`/sale/done/${rows.sale.id}`);
    expect(await screen.findByText('Item discounts')).toBeInTheDocument();
    expect(screen.getByText('Discount −Rs 10')).toBeInTheDocument();
    expect(screen.getByText('FOC')).toBeInTheDocument();
    expect(screen.getByText('Free items (value)')).toBeInTheDocument();
    expect(screen.getByText('Bill discount')).toBeInTheDocument();
    expect(await screen.findByText(/Discount approved by/)).toBeInTheDocument();
  });

  it('a cart stored before discounts existed still loads', async () => {
    await seedShop('owner');
    const tomato = await product('Tomato');
    const old = {
      ...(makeLine(
        {
          product_id: tomato.id,
          name: tomato.name,
          name_ur: null,
          unit: tomato.unit,
          icon: null,
          unit_price_paisa: tomato.sale_price_paisa,
        },
        1000,
      ) as CartLine),
    };
    delete (old as Partial<CartLine>).is_foc;
    delete (old as Partial<CartLine>).discount;
    await db.meta.put({ key: CART_KEY, value: { lines: [old] } });
    useCartStore.setState({ lines: [], ready: false });
    await useCartStore.getState().hydrate();
    expect(useCartStore.getState().lines[0]).toMatchObject({ is_foc: false, discount: null });
  });
});
