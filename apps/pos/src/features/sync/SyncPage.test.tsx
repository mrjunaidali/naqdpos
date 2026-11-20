import type { CartLine } from '@naqdpos/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewVersionBanner } from '../../app/NewVersionBanner.tsx';
import { db, type OutboxEntry } from '../../db/schema.ts';
import { patchSyncState } from '../../sync/state.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedReady, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { useCartStore } from '../sale/cartStore.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
const syncNow = vi.hoisted(() => vi.fn(() => Promise.resolve('synced')));
vi.mock('../../sync/index.ts', () => ({ syncEngine: { syncNow } }));

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  await seedReady();
  useCartStore.setState({ lines: [] });
  syncNow.mockClear();
});

function entry(n: number, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  const id = `019a9b8e-0000-7000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    table: 'staff',
    op: 'upsert',
    row: { ...staffRow({ id }) },
    row_key: `staff:${id}`,
    created_at: new Date().toISOString(),
    attempts: 0,
    actor_staff_id: null,
    ...overrides,
  };
}

let lineNo = 0;
const fakeLine = (): CartLine => ({
  id: `line-${++lineNo}`,
  product_id: null,
  is_custom: true,
  by_amount: false,
  name: 'Item',
  name_ur: null,
  unit: 'piece',
  icon: null,
  qty_milli: 1000,
  unit_price_paisa: 100,
  line_total_paisa: 100,
});

const chip = () => screen.findByRole('link', { name: /Sync status/ });

describe('sync chip in the header', () => {
  it('is green "Synced" when nothing is waiting', async () => {
    renderAt('/');
    const link = await chip();
    await waitFor(() => expect(link).toHaveTextContent('Synced'));
    expect(link).toHaveAttribute('data-tone', 'success');
    expect(link).toHaveAttribute('href', '/sync');
  });

  it('is amber "N pending" with entries in the outbox', async () => {
    await db.outbox.bulkAdd([entry(1), entry(2)]);
    renderAt('/');
    const link = await chip();
    await waitFor(() => expect(link).toHaveTextContent('2 pending'));
    expect(link).toHaveAttribute('data-tone', 'warning');
  });

  it('is red "Needs review" with rejected entries', async () => {
    await db.sync_errors.add({
      ...entry(3),
      code: 'other_shop',
      message: null,
      rejected_at: new Date().toISOString(),
    });
    renderAt('/');
    const link = await chip();
    await waitFor(() => expect(link).toHaveTextContent('Needs review'));
    expect(link).toHaveAttribute('data-tone', 'danger');
  });

  it('says "Sync paused" when sync is paused with nothing waiting', async () => {
    await patchSyncState(db, { authProblem: 'auth_required' });
    renderAt('/');
    const link = await chip();
    await waitFor(() => expect(link).toHaveTextContent('Sync paused'));
  });
});

describe('Sync screen', () => {
  it('lists rejected entries; clock_ahead tells the user to fix the phone time', async () => {
    const now = new Date().toISOString();
    await db.sync_errors.bulkAdd([
      { ...entry(4), code: 'clock_ahead', message: null, rejected_at: now },
      { ...entry(5), code: 'something_new', message: 'x', rejected_at: now },
    ]);
    renderAt('/sync');
    expect(await screen.findByRole('heading', { name: 'Needs review' })).toBeInTheDocument();
    expect(
      screen.getByText('Phone date/time is wrong — fix it and tap Sync now'),
    ).toBeInTheDocument();
    expect(screen.getByText('The server did not accept this change.')).toBeInTheDocument();
    expect(screen.getAllByText('Staff')).toHaveLength(2);
  });

  it.each([
    ['auth_required', 'Sign in again to sync'],
    ['device_unlinked', 'This device is no longer linked to the shop'],
  ] as const)('shows %s and never signs out', async (problem, text) => {
    await patchSyncState(db, { authProblem: problem });
    renderAt('/sync');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(await db.meta.get('session')).toBeDefined();
  });

  it('shows what is waiting and runs Sync now', async () => {
    await db.outbox.add(entry(6));
    renderAt('/sync');
    expect(await screen.findByText('1 change waiting to sync')).toBeInTheDocument();
    expect(screen.getByText('Not synced yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
  });
});

describe('update banners never offer a reload while the cart has items', () => {
  it('"Update required to sync" offers Reload only with an empty cart', async () => {
    await patchSyncState(db, { updateRequired: { minVersion: '2.0.0', appVersion: '1.0.0' } });
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Update required to sync');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

    useCartStore.setState({ lines: [fakeLine(), fakeLine()] });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull());
    expect(screen.getByText('Finish the sale, then reload.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument(); // still persistent
  });

  it('"New version available" hides while the cart has items or an update is required', async () => {
    const props = { visible: true, onLater: vi.fn(), onReload: vi.fn() };
    const { rerender } = render(<NewVersionBanner {...props} />);
    expect(await screen.findByText('New version available')).toBeInTheDocument();

    useCartStore.setState({ lines: [fakeLine()] });
    rerender(<NewVersionBanner {...props} />);
    expect(screen.queryByText('New version available')).toBeNull();

    useCartStore.setState({ lines: [] });
    await patchSyncState(db, { updateRequired: { minVersion: null, appVersion: '1.0.0' } });
    rerender(<NewVersionBanner {...props} />);
    await waitFor(() => expect(screen.queryByText('New version available')).toBeNull());
  });
});
