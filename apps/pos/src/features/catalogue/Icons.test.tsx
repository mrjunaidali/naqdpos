import { FRESH_PRODUCE } from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedReady, STAFF_ID } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { createFromPresets, saveProduct, setProductHidden } from './catalogueRepo.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const preset = (key: string) => FRESH_PRODUCE.find((p) => p.key === key)!;
const byName = async (name: string) => (await db.products.toArray()).find((p) => p.name === name)!;

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  await seedReady('owner');
});

describe('preset icons on products (US078)', () => {
  it('a product made from a preset gets its icon; no icon where none fits', async () => {
    await createFromPresets(
      [
        { preset: preset('potato'), rate: 8000 },
        { preset: preset('turnip'), rate: null },
      ],
      STAFF_ID,
    );
    expect((await byName('Potato')).icon).toBe('🥔');
    expect((await byName('Turnip')).icon).toBeNull();
    const entry = (await db.outbox.toArray()).find((e) => e.row.name === 'Potato');
    expect(entry?.row.icon).toBe('🥔');
  });

  it('restoring keeps a picture the owner chose, and fills one in when there was none', async () => {
    await createFromPresets(
      [
        { preset: preset('potato'), rate: 8000 },
        { preset: preset('tomato'), rate: 5000 },
      ],
      STAFF_ID,
    );
    const potato = await byName('Potato');
    await db.products.update(potato.id, { icon: '🍠' });
    const tomato = await byName('Tomato');
    await db.products.update(tomato.id, { icon: null });
    await setProductHidden(await byName('Potato'), true, STAFF_ID);
    await setProductHidden(await byName('Tomato'), true, STAFF_ID);

    await createFromPresets(
      [
        { preset: preset('potato'), rate: null },
        { preset: preset('tomato'), rate: null },
      ],
      STAFF_ID,
    );
    expect(await byName('Potato')).toMatchObject({ deleted_at: null, icon: '🍠' });
    expect(await byName('Tomato')).toMatchObject({ deleted_at: null, icon: '🍅' });
  });
});

describe('Picture field (US078)', () => {
  it('sets a picture on a new product', async () => {
    const { router } = renderAt('/products/new');
    fireEvent.change(await screen.findByLabelText('Name (English)'), {
      target: { value: 'Tomato' },
    });
    fireEvent.change(screen.getByLabelText('Sale price (Rs)'), { target: { value: '60' } });
    const picture = screen.getByRole('group', { name: 'Picture' });
    expect(within(picture).getByRole('button', { name: 'No picture' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(picture).getByRole('button', { name: 'Picture 🍅' }));
    expect(within(picture).getByRole('button', { name: 'Picture 🍅' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    expect((await byName('Tomato')).icon).toBe('🍅');
  });

  it('clears a picture with None', async () => {
    const id = await saveProduct(
      null,
      {
        name: 'Potato',
        name_ur: null,
        unit: 'kg',
        category_id: null,
        sale_price_paisa: 8000,
        cost_price_paisa: null,
        search_terms: [],
        track_stock: false,
        icon: '🥔',
      },
      STAFF_ID,
      true,
    );
    const { router } = renderAt(`/products/${id}`);
    const picture = await screen.findByRole('group', { name: 'Picture' });
    expect(within(picture).getByRole('button', { name: 'Picture 🥔' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(picture).getByRole('button', { name: 'No picture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    expect((await db.products.get(id))?.icon).toBeNull();
    const last = (await db.outbox.toArray()).at(-1);
    expect(last?.row.icon).toBeNull();
  });
});

describe('icons on tiles and rows', () => {
  beforeEach(async () => {
    await createFromPresets(
      [
        { preset: preset('potato'), rate: 8000 },
        { preset: preset('turnip'), rate: 4000 },
      ],
      STAFF_ID,
    );
  });

  it('product grid: the picture on top, and the same space kept when there is none', async () => {
    renderAt('/products');
    const potato = (await screen.findByText('Potato')).closest('li')!;
    const turnip = screen.getByText('Turnip').closest('li')!;
    const potatoIcon = within(potato).getByTestId('product-icon');
    const turnipIcon = within(turnip).getByTestId('product-icon');
    expect(potatoIcon).toHaveTextContent('🥔');
    expect(turnipIcon).toBeEmptyDOMElement();
    expect(potatoIcon.className).toBe(turnipIcon.className); // same fixed height
    expect(potatoIcon).toHaveAttribute('aria-hidden', 'true');
  });

  it('the preset picker shows the picture', async () => {
    renderAt('/products/presets');
    fireEvent.change(await screen.findByLabelText('Search the list'), {
      target: { value: 'mango' },
    });
    const mango = (await screen.findByText('Mango (Chaunsa)')).closest('li')!;
    expect(within(mango).getByTestId('product-icon')).toHaveTextContent('🥭');
  });

  it('Today’s rates rows show the picture', async () => {
    renderAt('/products/rates');
    const row = (await screen.findByText('Potato')).closest('li')!;
    expect(within(row).getByTestId('product-icon')).toHaveTextContent('🥔');
  });
});
