// The ready-made list follows the shop's type (bug 2026-11-25): fruit & veg shops get the fresh
// produce list; grocery, meat and general shops get none, never another type's list.
import type { ShopType } from '@naqdpos/core';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedReady, SHOP_ID } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

async function seedShop(type: ShopType) {
  await seedReady();
  await db.shops.update(SHOP_ID, { type });
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
});

describe('ready-made list by shop type', () => {
  it('fruit_veg: Products offers "Add from list" and the list opens', async () => {
    await seedShop('fruit_veg');
    renderAt('/products');
    expect(await screen.findByRole('link', { name: 'Add from list' })).toHaveAttribute(
      'href',
      '/products/presets',
    );
    cleanup();
    renderAt('/products/presets');
    expect(await screen.findByRole('heading', { name: 'Pick your products' })).toBeInTheDocument();
    expect(await screen.findByText('Potato')).toBeInTheDocument();
  });

  it.each(['general', 'grocery', 'meat'] as const)(
    '%s: no "Add from list"; the route says there is no list and links to Add product',
    async (type) => {
      await seedShop(type);
      renderAt('/products');
      await screen.findByRole('heading', { name: 'Products' });
      await screen.findByRole('link', { name: 'Add product' });
      // Let the shop row load first, so "no link" is not just "not loaded yet".
      await new Promise((r) => setTimeout(r, 150));
      expect(screen.queryByRole('link', { name: 'Add from list' })).toBeNull();

      cleanup();
      renderAt('/products/presets');
      expect(
        await screen.findByText(/No ready-made list for this shop type yet/),
      ).toBeInTheDocument();
      expect(screen.queryByText('Potato')).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.getByRole('link', { name: 'Add product' })).toHaveAttribute(
        'href',
        '/products/new',
      );
    },
  );

  it('the onboarding step is skipped for a type without a list', async () => {
    await seedShop('general');
    const { router } = renderAt('/products/presets?from=onboarding');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('a type change in Settings applies without a reload (read live from Dexie)', async () => {
    await seedShop('fruit_veg');
    renderAt('/products');
    await screen.findByRole('link', { name: 'Add from list' });
    await db.shops.update(SHOP_ID, { type: 'general' });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Add from list' })).toBeNull());
    await db.shops.update(SHOP_ID, { type: 'fruit_veg' });
    expect(await screen.findByRole('link', { name: 'Add from list' })).toBeInTheDocument();
  });
});
