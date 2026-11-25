// The ml unit on screens (25 Nov 2026), and a unit this app version doesn't know (architecture §4).
import type { ProductUnit } from '@naqdpos/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { i18n } from '../../i18n/index.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedReady, STAFF_ID } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { useCartStore } from '../sale/cartStore.ts';
import { saveProduct } from './catalogueRepo.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

async function product(name: string, unit: ProductUnit, pricePaisa: number) {
  const id = await saveProduct(
    null,
    {
      name,
      name_ur: null,
      unit,
      category_id: null,
      sale_price_paisa: pricePaisa,
      cost_price_paisa: null,
      search_terms: [],
      track_stock: false,
      icon: null,
    },
    STAFF_ID,
    false,
  );
  return (await db.products.get(id))!;
}

const tile = async (name: string) => {
  const button = (await screen.findByText(name)).closest('button')!;
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  await seedReady();
  await i18n.changeLanguage('en');
});

describe('ml unit', () => {
  it('the product form offers ml, in English and Urdu', async () => {
    renderAt('/products/new');
    const unit = await screen.findByLabelText('Unit');
    expect(within(unit).getByRole('option', { name: 'ml' })).toHaveValue('ml');
    cleanup();
    await i18n.changeLanguage('ur');
    renderAt('/products/new');
    expect(
      within(await screen.findByLabelText('اکائی')).getByRole('option', { name: 'ملی لیٹر' }),
    ).toHaveValue('ml');
    await i18n.changeLanguage('en');
  });

  it('sells whole millilitres: 6 ml × Rs 50 = Rs 300, no decimal point', async () => {
    await product('Rose water', 'ml', 5000);
    renderAt('/sale');
    expect(await screen.findByText('Rs 50/ml')).toBeInTheDocument();
    fireEvent.click(await tile('Rose water'));
    const panel = screen.getByRole('dialog');
    expect(within(panel).queryByRole('button', { name: 'Decimal point' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: '6' }));
    expect(within(panel).getByText('6 ml × Rs 50 = Rs 300')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Add to cart' }));
    await waitFor(() =>
      expect(useCartStore.getState().lines[0]).toMatchObject({
        unit: 'ml',
        qty_milli: 6000,
        line_total_paisa: 30000,
      }),
    );
  });
});

describe('a unit this app version does not know', () => {
  it('shows the raw code on the tile, in the quantity panel and the product list; no crash', async () => {
    const rice = await product('Rice', 'kg', 100);
    // As pulled from a newer app version (the row schema accepts any short unit code).
    await db.products.put({ ...rice, unit: 'maund' });
    renderAt('/sale');
    expect(await screen.findByText('Rs 1/maund')).toBeInTheDocument();
    fireEvent.click(await tile('Rice'));
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByLabelText('Quantity in maund')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: '2' }));
    expect(within(panel).getByText('2 maund × Rs 1 = Rs 2')).toBeInTheDocument();
    cleanup();

    renderAt('/products');
    expect(await screen.findByText('Rice')).toBeInTheDocument();
    expect(screen.getByText('Rs 1/maund')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('unit.');
  });
});
