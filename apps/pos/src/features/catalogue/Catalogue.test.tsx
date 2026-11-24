import { FRESH_PRODUCE, presetsForPicker, type ProductRow } from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import {
  createFromPresets,
  moveCategory,
  saveCategory,
  saveProduct,
  saveTodaysRates,
  setProductHidden,
  shopCategories,
} from './catalogueRepo.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const preset = (key: string) => FRESH_PRODUCE.find((p) => p.key === key)!;
const typeInto = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(async () => {
  resetApiMock();
  await resetDb();
});

const outboxTables = async () => (await db.outbox.toArray()).map((e) => e.table).sort();
const value = (overrides: Partial<Parameters<typeof saveProduct>[1]> = {}) => ({
  name: 'Potato',
  name_ur: 'آلو',
  unit: 'kg' as const,
  category_id: null,
  sale_price_paisa: 8000,
  cost_price_paisa: null,
  search_terms: ['aloo'],
  track_stock: false,
  icon: null,
  ...overrides,
});

describe('product writes (US019)', () => {
  it('a new product with a price writes the product and a price_history row, with the actor', async () => {
    await seedReady();
    await saveProduct(null, value(), STAFF_ID, true);
    expect(await outboxTables()).toEqual(['price_history', 'products']);
    expect((await db.outbox.toArray()).every((e) => e.actor_staff_id === STAFF_ID)).toBe(true);
    const [history] = await db.price_history.toArray();
    expect(history).toMatchObject({ shop_id: SHOP_ID, sale_price_paisa: 8000 });
  });

  it('a price of 0 is allowed and writes no history row', async () => {
    await seedReady();
    await saveProduct(null, value({ sale_price_paisa: 0 }), STAFF_ID, true);
    expect(await outboxTables()).toEqual(['products']);
  });

  it('editing writes history only when the sale price changes', async () => {
    await seedReady();
    const id = await saveProduct(null, value(), STAFF_ID, true);
    const product = (await db.products.get(id))!;
    await db.outbox.clear();
    await saveProduct(product, value({ name: 'Potato (white)' }), STAFF_ID, true);
    expect(await outboxTables()).toEqual(['products']);
    await saveProduct(
      (await db.products.get(id))!,
      value({ sale_price_paisa: 9000 }),
      STAFF_ID,
      true,
    );
    expect(await outboxTables()).toEqual(['price_history', 'products', 'products']);
    expect((await db.price_history.toArray()).map((h) => h.sale_price_paisa)).toEqual([8000, 9000]);
  });

  it('records cost (current + history) only when asked for (owner devices)', async () => {
    await seedReady();
    const id = await saveProduct(null, value({ cost_price_paisa: 6000 }), STAFF_ID, true);
    expect(await db.product_costs.get(id)).toMatchObject({ cost_price_paisa: 6000 });
    expect(await db.product_cost_history.count()).toBe(1);
    await saveProduct(null, value({ name: 'Onion', cost_price_paisa: 5000 }), STAFF_ID, false);
    expect(await db.product_costs.count()).toBe(1);
    expect(await db.product_cost_history.count()).toBe(1);
  });

  it('hides and restores a product (soft delete)', async () => {
    await seedReady();
    const id = await saveProduct(null, value(), STAFF_ID, true);
    await setProductHidden((await db.products.get(id))!, true, STAFF_ID);
    expect((await db.products.get(id))?.deleted_at).not.toBeNull();
    await setProductHidden((await db.products.get(id))!, false, STAFF_ID);
    expect((await db.products.get(id))?.deleted_at).toBeNull();
  });
});

describe('product screens', () => {
  it('validates the form: name required, price required and not negative', async () => {
    await seedReady();
    renderAt('/products/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('This is required.')).toHaveLength(2);
    typeInto('Name (English)', 'Tomato');
    typeInto('Sale price (Rs)', '-5');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The price cannot be negative.')).toBeInTheDocument();
    expect(await db.products.count()).toBe(0);
  });

  it('owner device: saves name, Urdu name, price, cost and spellings', async () => {
    await seedReady('owner');
    const { router } = renderAt('/products/new');
    await screen.findByLabelText('Name (English)');
    typeInto('Name (English)', 'Tomato');
    typeInto('Name (Urdu)', 'ٹماٹر');
    typeInto('Sale price (Rs)', '120.50');
    typeInto('Cost price (Rs, optional)', '90');
    typeInto('Other names / spellings', 'tamatar, timatar');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    const [product] = await db.products.toArray();
    expect(product).toMatchObject({
      name: 'Tomato',
      name_ur: 'ٹماٹر',
      sale_price_paisa: 12050,
      search_terms: ['tamatar', 'timatar'],
    });
    expect(await db.product_costs.get(product!.id)).toMatchObject({ cost_price_paisa: 9000 });
  });

  it('shop device: no cost field, and the note says where costs are set', async () => {
    await seedReady('shop');
    await seedPin(STAFF_ID, '4821');
    renderAt('/products/new');
    await screen.findByRole('heading', { name: 'Owner PIN needed' });
    for (const d of '4821') fireEvent.click(await screen.findByRole('button', { name: d }));
    await screen.findByRole('heading', { name: 'Add product' });
    expect(screen.queryByLabelText('Cost price (Rs, optional)')).toBeNull();
    expect(
      screen.getByText('Cost prices are set on an owner device (the owner’s own phone).'),
    ).toBeInTheDocument();
  });

  it('hides Products in settings from a cashier', async () => {
    await seedReady();
    const cashier = '019a9b8e-0000-7000-8000-0000000000c2';
    await db.staff.put(
      staffRow({ id: cashier, name: 'Bilal', role: 'cashier', membership_user_id: null }),
    );
    await writeCurrentStaffId(cashier);
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('link', { name: 'Products' })).toBeNull();
  });

  it('quick price edit in the list writes the price and a history row', async () => {
    await seedReady();
    await saveProduct(null, value(), STAFF_ID, true);
    renderAt('/products');
    fireEvent.click(await screen.findByRole('button', { name: 'Change price of Potato' }));
    const input = screen.getByLabelText('New price of Potato in rupees');
    fireEvent.change(input, { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Rs 95/kg')).toBeInTheDocument();
    expect((await db.price_history.toArray()).map((h) => h.sale_price_paisa)).toEqual([8000, 9500]);
  });

  it('filters by category tab and by search (Roman Urdu)', async () => {
    await seedReady();
    await createFromPresets(
      [
        { preset: preset('potato'), rate: 8000 },
        { preset: preset('banana'), rate: 20000 },
      ],
      STAFF_ID,
    );
    renderAt('/products');
    await screen.findByText('Potato');
    fireEvent.click(screen.getByRole('button', { name: 'Fruits' }));
    await waitFor(() => expect(screen.queryByText('Potato')).toBeNull());
    expect(screen.getByText('Banana')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'aalu' } });
    await waitFor(() => expect(screen.queryByText('Banana')).toBeNull());
    expect(screen.getByText('Potato')).toBeInTheDocument();
  });
});

describe('categories (US021)', () => {
  it('creates, renames and reorders', async () => {
    await seedReady();
    const a = await saveCategory(null, { name: 'Vegetables', name_ur: null }, STAFF_ID);
    const b = await saveCategory(null, { name: 'Fruits', name_ur: 'پھل' }, STAFF_ID);
    expect((await shopCategories()).map((c) => c.name)).toEqual(['Vegetables', 'Fruits']);
    await moveCategory(b, -1, STAFF_ID);
    expect((await shopCategories()).map((c) => c.name)).toEqual(['Fruits', 'Vegetables']);
    await saveCategory((await db.categories.get(a))!, { name: 'Veg', name_ur: 'سبزی' }, STAFF_ID);
    expect(await db.categories.get(a)).toMatchObject({ name: 'Veg', name_ur: 'سبزی' });
    expect((await db.outbox.toArray()).every((e) => e.table === 'categories')).toBe(true);
  });

  it('reorders from the screen with the up and down buttons', async () => {
    await seedReady();
    await saveCategory(null, { name: 'Vegetables', name_ur: null }, STAFF_ID);
    await saveCategory(null, { name: 'Fruits', name_ur: null }, STAFF_ID);
    renderAt('/products/categories');
    fireEvent.click(await screen.findByRole('button', { name: 'Move Fruits up' }));
    await waitFor(async () =>
      expect((await shopCategories()).map((c) => c.name)).toEqual(['Fruits', 'Vegetables']),
    );
  });
});

describe('fresh produce presets (US072)', () => {
  it('creates products, the needed categories and history in ONE transaction', async () => {
    await seedReady();
    const spy = vi.spyOn(db, 'transaction');
    const result = await createFromPresets(
      [
        { preset: preset('potato'), rate: 8000 },
        { preset: preset('coriander'), rate: null },
        { preset: preset('onion_red'), rate: null },
      ],
      STAFF_ID,
    );
    expect(spy.mock.calls.filter((c) => c[0] === 'rw')).toHaveLength(1);
    spy.mockRestore();
    expect(result).toEqual({ created: 3, restored: 0, skipped: 0 });

    const categories = await shopCategories();
    expect(categories.map((c) => [c.name, c.name_ur])).toEqual([
      ['Vegetables', 'سبزیاں'],
      ['Greens & herbs', 'ساگ اور ہرے مصالحے'],
    ]);
    const potato = (await db.products.toArray()).find((p) => p.name === 'Potato')!;
    expect(potato).toMatchObject({
      name_ur: 'آلو',
      unit: 'kg',
      sale_price_paisa: 8000,
      category_id: categories[0]!.id,
    });
    expect(potato.search_terms).toContain('aalu');
    const coriander = (await db.products.toArray()).find((p) => p.name === 'Coriander')!;
    expect(coriander).toMatchObject({ sale_price_paisa: 0, unit: 'bundle' });
    // A rate gives a history row; blank gives price 0 and none.
    expect((await db.price_history.toArray()).map((h) => h.product_id)).toEqual([potato.id]);
    expect(await db.outbox.count()).toBe(2 + 3 + 1);
  });

  it('never creates a product twice and reuses existing categories', async () => {
    await seedReady();
    await createFromPresets([{ preset: preset('potato'), rate: null }], STAFF_ID);
    const again = await createFromPresets(
      [
        { preset: preset('potato'), rate: 9000 },
        { preset: preset('tomato'), rate: null },
      ],
      STAFF_ID,
    );
    expect(again).toEqual({ created: 1, restored: 0, skipped: 1 });
    expect((await db.products.toArray()).filter((p) => p.name === 'Potato')).toHaveLength(1);
    expect(await db.categories.count()).toBe(1);
  });

  it('restores a hidden product instead of duplicating it, with the new rate and a history row', async () => {
    await seedReady();
    await createFromPresets([{ preset: preset('potato'), rate: 8000 }], STAFF_ID);
    const potato = (await db.products.toArray())[0]!;
    await setProductHidden(potato, true, STAFF_ID);
    const result = await createFromPresets([{ preset: preset('potato'), rate: 9500 }], STAFF_ID);
    expect(result).toEqual({ created: 0, restored: 1, skipped: 0 });
    const products = await db.products.toArray();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ id: potato.id, deleted_at: null, sale_price_paisa: 9500 });
    expect((await db.price_history.toArray()).map((h) => h.sale_price_paisa)).toEqual([8000, 9500]);
  });

  it('the picker shows Added and Hidden, and ticking a hidden one restores it', async () => {
    await seedReady();
    await createFromPresets(
      [
        { preset: preset('potato'), rate: 8000 },
        { preset: preset('tomato'), rate: 5000 },
      ],
      STAFF_ID,
    );
    const tomato = (await db.products.toArray()).find((p) => p.name === 'Tomato')!;
    await setProductHidden(tomato, true, STAFF_ID);

    const { router } = renderAt('/products/presets');
    fireEvent.change(await screen.findByLabelText('Search the list'), {
      target: { value: 'tamatar' },
    });
    const row = (await screen.findByText('Tomato')).closest('li')!;
    expect(within(row).getByText('Hidden')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('checkbox'));
    fireEvent.change(within(row).getByLabelText('Today’s rate for Tomato in rupees'), {
      target: { value: '60' },
    });

    fireEvent.change(screen.getByLabelText('Search the list'), { target: { value: 'آلو' } });
    const potatoRow = (await screen.findByText('Potato')).closest('li')!;
    expect(within(potatoRow).getByText('Added')).toBeInTheDocument();
    expect(within(potatoRow).getByRole('checkbox')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add 1 product' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    expect(await db.products.get(tomato.id)).toMatchObject({
      deleted_at: null,
      sale_price_paisa: 6000,
    });
    expect(
      (await db.products.toArray()).filter((p: ProductRow) => p.name === 'Tomato'),
    ).toHaveLength(1);
  });
});

describe('select all on the preset picker', () => {
  const total = presetsForPicker().length;
  const addButton = () => screen.getByRole('button', { name: /^Add \d+ products?$/ });
  const rowCheckbox = (name: string) =>
    within(screen.getByText(name).closest('li')!).getAllByRole('checkbox')[0]!;

  /** Potato is already added, so its row is locked and never part of "Select all". */
  async function openPicker() {
    await seedReady();
    await createFromPresets([{ preset: preset('potato'), rate: 8000 }], STAFF_ID);
    renderAt('/products/presets');
    return screen.findByRole('checkbox', { name: 'Select all' });
  }

  it('ticks every row not yet added, shows the count on the button, and unticks them again', async () => {
    const all = await openPicker();
    expect(all).not.toBeChecked();
    expect(all).not.toBePartiallyChecked();

    fireEvent.click(all);
    expect(all).toBeChecked();
    expect(addButton()).toHaveTextContent(`Add ${total - 1} products`);
    expect(rowCheckbox('Tomato')).toBeChecked();
    expect(rowCheckbox('Potato')).toBeDisabled();

    fireEvent.click(all);
    expect(all).not.toBeChecked();
    expect(rowCheckbox('Tomato')).not.toBeChecked();
    expect(addButton()).toHaveTextContent('Add 0 products');
    expect(addButton()).toBeDisabled();
  });

  it('is indeterminate when only some rows are ticked', async () => {
    const all = await openPicker();
    fireEvent.click(rowCheckbox('Tomato'));
    expect(all).toBePartiallyChecked();
    expect(all).not.toBeChecked();

    fireEvent.click(all);
    expect(all).toBeChecked();
    expect(all).not.toBePartiallyChecked();

    fireEvent.click(rowCheckbox('Tomato'));
    expect(all).toBePartiallyChecked();
    expect(addButton()).toHaveTextContent(`Add ${total - 2} products`);
  });

  it('acts only on the rows the search shows and keeps rates already typed', async () => {
    const all = await openPicker();
    fireEvent.click(rowCheckbox('Onion (red)'));
    fireEvent.change(screen.getByLabelText('Today’s rate for Onion (red) in rupees'), {
      target: { value: '120' },
    });

    fireEvent.change(screen.getByLabelText('Search the list'), { target: { value: 'tamatar' } });
    await waitFor(() => expect(screen.queryByText('Onion (red)')).toBeNull());
    const visible = screen.getAllByRole('listitem').length;
    expect(all).not.toBeChecked();
    expect(all).not.toBePartiallyChecked();
    fireEvent.click(all);
    expect(all).toBeChecked();
    expect(addButton()).toHaveTextContent(`Add ${visible + 1} products`);

    // Back to the full list: only some are ticked now, and Onion (red) still has its rate.
    fireEvent.change(screen.getByLabelText('Search the list'), { target: { value: '' } });
    expect(await screen.findByText('Onion (red)')).toBeInTheDocument();
    expect(all).toBePartiallyChecked();
    expect(screen.getByLabelText('Today’s rate for Onion (red) in rupees')).toHaveValue('120');
  });

  it('is disabled when every row the search shows is already added', async () => {
    const all = await openPicker();
    fireEvent.change(screen.getByLabelText('Search the list'), { target: { value: 'aaloo' } });
    await waitFor(() => expect(screen.queryByText('Tomato')).toBeNull());
    const rows = screen.getAllByRole('listitem');
    // Only valid if the search shows just Potato; guard so a preset change fails loudly.
    expect(rows.map((r) => within(r).getAllByRole('checkbox')[0]!)).toEqual([
      rowCheckbox('Potato'),
    ]);
    expect(all).toBeDisabled();
  });
});

describe("today's rates (US020)", () => {
  it('saves every changed price (and cost on owner devices) in one transaction, offline', async () => {
    await seedReady('owner');
    await createFromPresets(
      [
        { preset: preset('potato'), rate: 8000 },
        { preset: preset('tomato'), rate: 5000 },
        { preset: preset('onion_red'), rate: 10000 },
      ],
      STAFF_ID,
    );
    await db.outbox.clear();
    const products = await db.products.toArray();
    const byName = (n: string) => products.find((p) => p.name === n)!;
    const spy = vi.spyOn(db, 'transaction');
    const changed = await saveTodaysRates(
      [
        { product: byName('Potato'), sale: 8500, cost: null },
        { product: byName('Tomato'), sale: 5000, cost: 3000 },
        { product: byName('Onion (red)'), sale: 10000, cost: null },
      ],
      STAFF_ID,
      true,
    );
    expect(spy.mock.calls.filter((c) => c[0] === 'rw')).toHaveLength(1);
    spy.mockRestore();
    expect(changed).toBe(2);
    expect(await outboxTables()).toEqual([
      'price_history',
      'product_cost_history',
      'product_costs',
      'products',
    ]);
  });

  it('Save all from the screen', async () => {
    await seedReady('owner');
    await createFromPresets([{ preset: preset('potato'), rate: 8000 }], STAFF_ID);
    renderAt('/products/rates');
    fireEvent.change(await screen.findByLabelText('Sale price of Potato'), {
      target: { value: '85' },
    });
    fireEvent.change(screen.getByLabelText('Cost price of Potato'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));
    expect(await screen.findByText('1 product updated.')).toBeInTheDocument();
    const potato = (await db.products.toArray())[0]!;
    expect(potato.sale_price_paisa).toBe(8500);
    expect(await db.product_costs.get(potato.id)).toMatchObject({ cost_price_paisa: 6000 });
  });

  it('shows no cost column on a shop device', async () => {
    await seedReady('shop');
    await seedPin(STAFF_ID, '4821');
    await createFromPresets([{ preset: preset('potato'), rate: 8000 }], STAFF_ID);
    renderAt('/products/rates');
    for (const d of '4821') fireEvent.click(await screen.findByRole('button', { name: d }));
    await screen.findByLabelText('Sale price of Potato');
    expect(screen.queryByLabelText('Cost price of Potato')).toBeNull();
  });
});
