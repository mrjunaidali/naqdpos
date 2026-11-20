import { FRESH_PRODUCE } from '@naqdpos/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { i18n } from '../../i18n/index.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { createFromPresets } from '../catalogue/catalogueRepo.ts';
import { cartSaved, useCartStore } from './cartStore.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const preset = (key: string) => FRESH_PRODUCE.find((p) => p.key === key)!;

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
    [
      { preset: preset('tomato'), rate: 16000 },
      { preset: preset('potato'), rate: 8000 },
      { preset: preset('banana'), rate: 24000 },
      { preset: preset('coconut'), rate: 25000 },
      { preset: preset('coriander'), rate: null }, // rate never set
    ],
    STAFF_ID,
  );
  await db.outbox.clear();
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  setOnline(true);
});
afterEach(() => setOnline(true));

/** The product tile, once it can be tapped (the current staff member has loaded). */
const tile = async (name: string) => {
  const button = (await screen.findByText(name)).closest('button')!;
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};
const customButton = async () => {
  const button = await screen.findByRole('button', { name: 'Custom item' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};
const panel = () => screen.getByRole('dialog');
const press = (keys: string) => {
  for (const k of keys) {
    const name = k === '.' ? 'Decimal point' : k;
    fireEvent.click(within(panel()).getByRole('button', { name }));
  }
};
const lines = () => useCartStore.getState().lines;

describe('sale screen (US029)', () => {
  it('opens from Home with "New sale"', async () => {
    await seedShop();
    const { router } = renderAt('/');
    fireEvent.click(await screen.findByRole('link', { name: 'New sale' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale'));
    expect(await screen.findByRole('heading', { name: 'New sale' })).toBeInTheDocument();
    expect((await screen.findAllByText('Ali · A1')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Customer' })).toBeDisabled();
  });

  it('searches English, Urdu and Roman Urdu; "/" focuses the search', async () => {
    await seedShop();
    renderAt('/sale');
    await tile('Tomato');
    fireEvent.keyDown(window, { key: '/' });
    const search = screen.getByLabelText('Search products');
    expect(search).toHaveFocus();
    for (const q of ['aalu', 'آلو', 'potato']) {
      fireEvent.change(search, { target: { value: q } });
      await waitFor(() => expect(screen.queryByText('Tomato')).toBeNull());
      expect(screen.getByText('Potato')).toBeInTheDocument();
    }
  });

  it('adds with a quick button: border, badge, cart bar', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Tomato'));
    fireEvent.click(within(panel()).getByRole('button', { name: '500 g' }));
    const t = await tile('Tomato');
    await waitFor(() => expect(t).toHaveAttribute('data-in-cart', 'true'));
    expect(t.className).toContain('border-primary');
    expect(within(t).getByText('500 g')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open cart, 1 item/ })).toHaveTextContent('Rs 80');
    expect(screen.getByRole('button', { name: 'Charge' })).toBeEnabled();
  });

  it('tapping a product in the cart edits its line; the keypad takes decimals for kg; remove', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Tomato'));
    fireEvent.click(within(panel()).getByRole('button', { name: '1 kg' }));
    fireEvent.click(await tile('Tomato'));
    press('1.5');
    expect(within(panel()).getByText('1.5 kg × Rs 160 = Rs 240')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(lines()).toHaveLength(1));
    expect(lines()[0]).toMatchObject({ qty_milli: 1500, line_total_paisa: 24000 });

    fireEvent.click(await tile('Tomato'));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove from cart' }));
    await waitFor(() => expect(lines()).toHaveLength(0));
  });

  it('offers the right quick buttons and keypad per unit', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Banana'));
    for (const q of ['½ dozen', '1 dozen', '2 dozen', '3 dozen']) {
      expect(within(panel()).getByRole('button', { name: q })).toBeInTheDocument();
    }
    expect(within(panel()).getByRole('button', { name: 'Decimal point' })).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: 'By amount' })).toBeNull();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));

    fireEvent.click(await tile('Coconut'));
    for (const q of ['1 piece', '2 piece', '6 piece', '12 piece']) {
      expect(within(panel()).getByRole('button', { name: q })).toBeInTheDocument();
    }
    expect(within(panel()).queryByRole('button', { name: 'Decimal point' })).toBeNull();
    fireEvent.click(within(panel()).getByRole('button', { name: '6 piece' }));
    await waitFor(() =>
      expect(lines()[0]).toMatchObject({ qty_milli: 6000, line_total_paisa: 150000 }),
    );
  });

  it('by amount: Rs 50 of tomatoes = exactly Rs 50 for ≈ 315 g', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Tomato'));
    fireEvent.click(within(panel()).getByRole('button', { name: 'By amount' }));
    press('50');
    expect(within(panel()).getByText('≈ 315 g for Rs 50')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add to cart' }));
    await waitFor(() =>
      expect(lines()[0]).toMatchObject({
        qty_milli: 315,
        unit_price_paisa: 16000,
        line_total_paisa: 5000,
        by_amount: true,
      }),
    );
  });
});

describe('rate never set (US072 rate prompt, decision 1)', () => {
  it('a rate for this sale applies to the line only', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Coriander'));
    expect(within(panel()).getByText('Rate for this sale (Rs per bundle)')).toBeInTheDocument();
    press('20');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Continue' }));
    fireEvent.click(within(panel()).getByRole('button', { name: '2 bundle' }));
    await waitFor(() =>
      expect(lines()[0]).toMatchObject({ unit_price_paisa: 2000, line_total_paisa: 4000 }),
    );
    expect(
      (await db.products.toArray()).find((p) => p.name === 'Coriander')?.sale_price_paisa,
    ).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('"Also save as today’s rate" asks a cashier for the owner PIN, then writes price + history', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    renderAt('/sale');
    fireEvent.click(await tile('Coriander'));
    press('20');
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Also save as today’s rate' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Continue' }));

    const pin = await screen.findByRole('dialog', { name: 'Owner PIN needed' });
    for (const d of '4821') fireEvent.click(await within(pin).findByRole('button', { name: d }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Owner PIN needed' })).toBeNull(),
    );

    const coriander = (await db.products.toArray()).find((p) => p.name === 'Coriander')!;
    expect(coriander.sale_price_paisa).toBe(2000);
    const outbox = await db.outbox.toArray();
    expect(outbox.map((e) => e.table).sort()).toEqual(['price_history', 'products']);
    expect(outbox.every((e) => e.actor_staff_id === STAFF_ID)).toBe(true);
    fireEvent.click(within(panel()).getByRole('button', { name: '1 bundle' }));
    await waitFor(() => expect(lines()[0]).toMatchObject({ unit_price_paisa: 2000 }));
  });

  it('by amount needs a rate first (Rs 100 at Rs 0 is refused)', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Coriander'));
    expect(within(panel()).queryByRole('button', { name: 'By amount' })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: 'Add to cart' })).toBeNull();
  });
});

describe('custom item (US030)', () => {
  it('adds a line without a product, flagged as custom', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await customButton());
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Fruit basket' } });
    fireEvent.change(screen.getByLabelText('Price per unit (Rs)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add to cart' }));
    await waitFor(() =>
      expect(lines()[0]).toMatchObject({
        product_id: null,
        is_custom: true,
        name: 'Fruit basket',
        unit: 'piece',
        line_total_paisa: 100000,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Open cart/ }));
    expect(within(panel()).getByText('Custom')).toBeInTheDocument();
  });

  it('checks the custom item form', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await customButton());
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1.5' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add to cart' }));
    expect(await within(panel()).findByText('This is required.')).toBeInTheDocument();
    expect(within(panel()).getByText('Enter a price above 0.')).toBeInTheDocument();
    expect(within(panel()).getByText('Too many decimals for this unit.')).toBeInTheDocument();
    expect(lines()).toHaveLength(0);
  });
});

describe('cart', () => {
  it('survives a reload (kept in Dexie meta, not synced)', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Potato'));
    fireEvent.click(within(panel()).getByRole('button', { name: '1.5 kg' }));
    await waitFor(() => expect(lines()).toHaveLength(1));
    await cartSaved();
    expect(await db.outbox.count()).toBe(0);

    cleanup();
    useCartStore.setState({ lines: [], ready: false });
    renderAt('/sale');
    expect(await screen.findByRole('button', { name: /Open cart, 1 item/ })).toHaveTextContent(
      'Rs 120',
    );
    expect(await tile('Potato')).toHaveAttribute('data-in-cart', 'true');
  });

  it('"Clear cart" asks first', async () => {
    await seedShop();
    renderAt('/sale');
    fireEvent.click(await tile('Potato'));
    fireEvent.click(within(panel()).getByRole('button', { name: '1 kg' }));
    fireEvent.click(await screen.findByRole('button', { name: /Open cart/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Clear cart' }));
    expect(within(panel()).getByText('Remove every item from the cart?')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Cancel' }));
    expect(lines()).toHaveLength(1);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Clear cart' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Yes, clear' }));
    await waitFor(() => expect(lines()).toHaveLength(0));
  });

  it('works fully offline: no API call anywhere in the flow', async () => {
    await seedShop();
    setOnline(false);
    renderAt('/sale');
    fireEvent.click(await tile('Tomato'));
    fireEvent.click(within(panel()).getByRole('button', { name: 'By amount' }));
    press('100');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add to cart' }));
    await waitFor(() =>
      expect(lines()[0]).toMatchObject({ qty_milli: 625, line_total_paisa: 10000 }),
    );
    for (const fn of Object.values(vi.mocked(api))) expect(fn).not.toHaveBeenCalled();
  });

  it('asks who is working when nobody valid is switched in; tiles are disabled', async () => {
    await seedShop();
    await db.staff.update(STAFF_ID, { active: false });
    renderAt('/sale');
    expect(await screen.findByRole('dialog', { name: 'Who is working?' })).toBeInTheDocument();
    const tomato = (await screen.findByText('Tomato')).closest('button')!;
    expect(tomato).toBeDisabled();
  });
});

describe('Urdu (RTL)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('mirrors the page, shows Urdu names first and keeps number entry left-to-right', async () => {
    await seedShop();
    await i18n.changeLanguage('ur');
    renderAt('/sale');
    expect(document.documentElement.dir).toBe('rtl');
    fireEvent.click(await tile('ٹماٹر'));
    const keypad = within(panel()).getByRole('button', { name: '7' }).parentElement!;
    expect(keypad).toHaveAttribute('dir', 'ltr');
  });
});
