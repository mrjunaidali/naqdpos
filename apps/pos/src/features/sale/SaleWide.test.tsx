// Sale screen on wide screens (≥768px): two panes, cart panel always shown, stepper, ⋮ menu.
import { FRESH_PRODUCE, makeLine, type CartLine } from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, STAFF_ID } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { createFromPresets } from '../catalogue/catalogueRepo.ts';
import { cartSaved, useCartStore } from './cartStore.ts';
import { qtyStep, stepLine } from './qtyStep.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const preset = (key: string) => FRESH_PRODUCE.find((p) => p.key === key)!;

function matchMediaWide(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('min-width') ? wide : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

async function seedShop() {
  await seedReady('owner');
  await seedPin(STAFF_ID, '4821');
  await createFromPresets(
    [
      { preset: preset('tomato'), rate: 16000 }, // kg
      { preset: preset('coconut'), rate: 25000 }, // piece
      { preset: preset('coriander'), rate: null }, // no rate
    ],
    STAFF_ID,
  );
  await db.outbox.clear();
}

function line(
  name: string,
  unit: CartLine['unit'],
  rate: number,
  qty: number,
  extra: Partial<CartLine> = {},
): CartLine {
  const made = makeLine(
    { product_id: `p-${name}`, name, name_ur: null, unit, icon: null, unit_price_paisa: rate },
    qty,
  ) as CartLine;
  return { ...made, ...extra };
}

const cartPanel = () => screen.getByRole('region', { name: 'Cart' });
/** The sale screen, once the stored cart has loaded (so a late load can't undo a tap). */
async function openSale() {
  const view = renderAt('/sale');
  await screen.findByRole('region', { name: 'Cart' });
  await waitFor(() => expect(useCartStore.getState().ready).toBe(true));
  await cartSaved();
  return view;
}
const qtyOf = (name: string) => useCartStore.getState().lines.find((l) => l.name === name);

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  matchMediaWide(true);
});
afterEach(() => Reflect.deleteProperty(window, 'matchMedia'));

describe('stepper steps (qtyStep / stepLine)', () => {
  it('250 g for kg and litre, one unit otherwise', () => {
    expect(qtyStep('kg')).toBe(250);
    expect(qtyStep('litre')).toBe(250);
    expect(qtyStep('piece')).toBe(1000);
    expect(qtyStep('dozen')).toBe(1000);
  });

  it('recomputes the total, keeps discount and FOC, never goes below one step', () => {
    const tomato = line('Tomato', 'kg', 16000, 1000, { discount: { kind: 'rs', value: 500 } });
    expect(stepLine(tomato, 1)).toMatchObject({
      id: tomato.id,
      qty_milli: 1250,
      line_total_paisa: 20000,
      discount: { kind: 'rs', value: 500 },
    });
    expect(stepLine(line('Tomato', 'kg', 16000, 300), -1)?.qty_milli).toBe(250);
    expect(stepLine(line('Tomato', 'kg', 16000, 250), -1)).toBeNull();
    const free = line('Coconut', 'piece', 25000, 2000, { is_foc: true });
    expect(stepLine(free, -1)).toMatchObject({ qty_milli: 1000, is_foc: true });
    expect(stepLine(line('Coconut', 'piece', 25000, 9_999_000), 1)).toBeNull(); // line limit
  });

  it('a "by amount" line steps from its quantity and becomes qty × rate', () => {
    const byAmount = {
      ...line('Tomato', 'kg', 16000, 625),
      by_amount: true,
      line_total_paisa: 10000,
    };
    expect(stepLine(byAmount, 1)).toMatchObject({
      qty_milli: 875,
      line_total_paisa: 14000,
      by_amount: false,
    });
  });
});

describe('wide sale screen', () => {
  it('shows the cart panel with an empty state, and one toolbar row', async () => {
    await seedShop();
    renderAt('/sale');
    const panel = await screen.findByRole('region', { name: 'Cart' });
    expect(within(panel).getByText('Tap a product to add it')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Charge Rs 0' })).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: 'Clear cart' })).toBeNull();
    // The customer chip lives in the cart header; no phone cart bar.
    expect(within(panel).getByRole('button', { name: /Customer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open cart/ })).toBeNull();
    // Toolbar: back, title, search, Custom item in one row; "name · code" is not repeated.
    const toolbar = screen.getByRole('heading', { name: 'New sale' }).parentElement!;
    expect(within(toolbar).getByRole('searchbox', { name: 'Search products' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Custom item' })).toBeInTheDocument();
    expect(screen.queryByText(/ · A1$/)).toBeNull();
  });

  it('tiles: centred, names up to 2 lines with a title, /pc for pieces, "Set rate" without a rate', async () => {
    await seedShop();
    renderAt('/sale');
    const coconut = (await screen.findByText('Coconut')).closest('button')!;
    expect(coconut).toHaveAttribute('title', 'Coconut');
    // Bug 2026-11-26: centred at every width (no breakpoint-only alignment), long names wrap.
    expect(coconut).toHaveClass('items-center', 'justify-center', 'text-center', 'w-full');
    expect(within(coconut).getByText('Coconut')).toHaveClass('line-clamp-2');
    expect(within(coconut).getByText('Rs 250/pc')).toBeInTheDocument();
    const coriander = (await screen.findByText('Coriander')).closest('button')!;
    expect(within(coriander).getByText('Set rate')).toHaveClass('text-warning');
  });

  it('the stepper changes qty_milli: 250 g for kg, 1 for pieces; Charge shows the total', async () => {
    await seedShop();
    useCartStore.getState().put(line('Tomato', 'kg', 16000, 1000));
    useCartStore.getState().put(line('Coconut', 'piece', 25000, 1000));
    await openSale();
    // Rs 160 + Rs 250
    expect(within(cartPanel()).getByRole('button', { name: 'Charge Rs 410' })).toBeEnabled();

    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'More Tomato' }));
    expect(qtyOf('Tomato')).toMatchObject({ qty_milli: 1250, line_total_paisa: 20000 });
    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'More Coconut' }));
    expect(qtyOf('Coconut')?.qty_milli).toBe(2000);
    expect(within(cartPanel()).getByText('2 piece')).toBeInTheDocument(); // full label in the cart
    expect(within(cartPanel()).getByRole('button', { name: 'Charge Rs 700' })).toBeInTheDocument();

    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'Less Coconut' }));
    expect(qtyOf('Coconut')?.qty_milli).toBe(1000);
    expect(within(cartPanel()).getByRole('button', { name: 'Less Coconut' })).toBeDisabled();
    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'Less Tomato' }));
    expect(qtyOf('Tomato')?.qty_milli).toBe(1000);
  });

  it('⋮ menu: Free, Discount and Remove with the phone labels; tapping the name edits', async () => {
    await seedShop();
    useCartStore.getState().put(line('Tomato', 'kg', 16000, 1000));
    useCartStore.getState().put(line('Coconut', 'piece', 25000, 1000));
    await openSale();
    const menu = (name: string) =>
      fireEvent.click(
        within(cartPanel()).getByRole('button', { name: `More options for ${name}` }),
      );

    menu('Coconut');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Free: Coconut' }));
    expect(qtyOf('Coconut')?.is_foc).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(within(cartPanel()).getByText('Free items (value)')).toBeInTheDocument();

    menu('Tomato');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount on Tomato' }));
    expect(await screen.findByRole('dialog', { name: 'Discount — Tomato' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    menu('Tomato');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Tomato' }));
    await waitFor(() => expect(qtyOf('Tomato')).toBeUndefined());

    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'Change Coconut' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('Clear cart asks first, then the empty state comes back', async () => {
    await seedShop();
    useCartStore.getState().put(line('Tomato', 'kg', 16000, 1000));
    await openSale();
    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'Clear cart' }));
    expect(within(cartPanel()).getByText('Remove every item from the cart?')).toBeInTheDocument();
    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'Yes, clear' }));
    expect(within(cartPanel()).getByText('Tap a product to add it')).toBeInTheDocument();
  });

  it('Charge opens the pay screen', async () => {
    await seedShop();
    useCartStore.getState().put(line('Tomato', 'kg', 16000, 1000));
    const { router } = await openSale();
    fireEvent.click(within(cartPanel()).getByRole('button', { name: 'Charge Rs 160' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale/pay'), {
      timeout: 5000,
    });
  });
});
