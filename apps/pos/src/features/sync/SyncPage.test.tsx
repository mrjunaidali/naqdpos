import type { CartLine } from '@naqdpos/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewVersionBanner } from '../../app/NewVersionBanner.tsx';
import { i18n } from '../../i18n/index.ts';
import { db, type OutboxEntry } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { patchSyncState, SYNC_META } from '../../sync/state.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, SHOP_ID, seedReady, STAFF_ID, staffRow } from '../../test/fixtures.ts';
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
  is_foc: false,
  discount: null,
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

// Bug 2026-11-25: "Needs review — sync.table.products — The data was not valid."
describe('Sync screen: rejected entries (names, fields, Try again)', () => {
  const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
  const PRODUCT = '019a9b8e-0000-7000-8000-0000000000f1';
  const rejectedProduct = (n: number, overrides: Record<string, unknown> = {}) => {
    const base = entry(n, {
      table: 'products',
      row: { id: PRODUCT, shop_id: SHOP_ID, name: 'Rose water', unit: 'ml' },
      row_key: `products:${PRODUCT}`,
    });
    return {
      ...base,
      code: 'invalid',
      message: 'unit: Invalid option',
      field: 'unit',
      rejected_at: new Date().toISOString(),
      ...overrides,
    };
  };
  const setOnline = (value: boolean) => {
    Object.defineProperty(navigator, 'onLine', { value, configurable: true });
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  };

  beforeEach(async () => {
    setOnline(true);
    await writeCurrentStaffId(STAFF_ID);
  });

  it('names the record, its table and the field; never a raw key', async () => {
    await db.sync_errors.add(rejectedProduct(10));
    renderAt('/sync');
    const item = await screen.findByTestId('rejected-entry');
    expect(item).toHaveTextContent('Rose water');
    expect(item).toHaveTextContent('Products');
    expect(item).toHaveTextContent('Unit was not accepted.');
    expect(item).not.toHaveTextContent('The data was not valid.');
    expect(document.body).not.toHaveTextContent('sync.table');
  });

  it('falls back to the code message without a field (entries stored before field existed)', async () => {
    await db.sync_errors.add(rejectedProduct(11, { field: undefined }));
    renderAt('/sync');
    expect(await screen.findByText('The data was not valid.')).toBeInTheDocument();
  });

  it.each([
    [1, '1 change was not accepted'],
    [3, '3 changes were not accepted'],
  ])('headline with %i rejected: "%s", in the warning style', async (n, text) => {
    await db.sync_errors.bulkAdd(Array.from({ length: n }, (_, i) => rejectedProduct(20 + i)));
    renderAt('/sync');
    const status = await screen.findByText(text);
    await waitFor(() =>
      expect(status.closest('[role=status]')).toHaveAttribute('data-tone', 'warning'),
    );
    expect(screen.queryByText('Everything is synced.')).not.toBeInTheDocument();
  });

  it('says "Everything is synced." only with nothing pending or rejected', async () => {
    renderAt('/sync');
    expect(await screen.findByText('Everything is synced.')).toBeInTheDocument();
  });

  it('owner: Try again puts the entry back in the outbox and syncs', async () => {
    const rejected = rejectedProduct(30);
    await db.sync_errors.add(rejected);
    renderAt('/sync');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again: Rose water' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
    expect(await db.sync_errors.count()).toBe(0);
    expect(await db.outbox.get(rejected.id)).toMatchObject({ attempts: 0, table: 'products' });
  });

  it('owner: Try all again requeues every rejected entry', async () => {
    await db.sync_errors.bulkAdd([rejectedProduct(31), rejectedProduct(32)]);
    renderAt('/sync');
    fireEvent.click(await screen.findByRole('button', { name: 'Try all again' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
    expect(await db.outbox.count()).toBe(2);
    expect(await db.sync_errors.count()).toBe(0);
  });

  it('owner offline: Try again queues the entry without syncing', async () => {
    setOnline(false);
    await db.sync_errors.add(rejectedProduct(33));
    renderAt('/sync');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again: Rose water' }));
    expect(
      await screen.findByText('Queued. It will be sent when you are back online.'),
    ).toBeInTheDocument();
    expect(syncNow).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(1);
  });

  it('cashier: sees that the owner must review, with no Try again', async () => {
    await db.staff.put(staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier' }));
    await writeCurrentStaffId(CASHIER);
    await db.sync_errors.bulkAdd([rejectedProduct(40), rejectedProduct(41)]);
    renderAt('/sync');
    expect(await screen.findByText('The owner needs to review these changes.')).toBeInTheDocument();
    expect(screen.getAllByTestId('rejected-entry')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Try (all )?again/ })).not.toBeInTheDocument();
  });

  it('says when changes wait for a server that does not know their unit yet', async () => {
    await db.outbox.add(
      entry(50, {
        table: 'products',
        row: { id: PRODUCT, shop_id: SHOP_ID, name: 'Rose water', unit: 'ml' },
        row_key: `products:${PRODUCT}`,
      }),
    );
    renderAt('/sync');
    expect(
      await screen.findByText('1 change waits for a server update (unit: ml).'),
    ).toBeInTheDocument();
    await db.meta.put({ key: SYNC_META.SERVER_UNITS, value: ['kg', 'ml'] });
    await waitFor(() =>
      expect(screen.queryByText(/waits for a server update/)).not.toBeInTheDocument(),
    );
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

describe('Sync screen: rows from the server this device could not store', () => {
  const PRODUCT = '019a9b8e-0000-7000-8000-0000000000f7';
  const pullProblem = (overrides: Record<string, unknown> = {}) => ({
    id: `pull:products:${PRODUCT}`,
    table: 'products' as const,
    op: 'pull' as const,
    row: { id: PRODUCT, shop_id: SHOP_ID, name: 'Rose water', unit: 'ml' },
    row_key: `products:${PRODUCT}`,
    created_at: new Date().toISOString(),
    attempts: 0,
    actor_staff_id: null,
    server_seq: 41,
    code: 'pull_invalid',
    message: 'sale_price_paisa: Too small',
    field: 'sale_price_paisa',
    rejected_at: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    await writeCurrentStaffId(STAFF_ID);
  });

  it('lists them apart from rejected changes, with name, table and field; no Try again', async () => {
    await db.sync_errors.add(pullProblem());
    renderAt('/sync');
    const section = await screen.findByTestId('pull-problems');
    expect(
      within(section).getByRole('heading', { name: 'Not stored on this device' }),
    ).toBeInTheDocument();
    const item = within(section).getByTestId('pull-problem');
    expect(item).toHaveTextContent('Rose water');
    expect(item).toHaveTextContent('Products');
    expect(item).toHaveTextContent('Sale price could not be read.');
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('rejected-entry')).not.toBeInTheDocument();
    const status = screen.getByText('1 record from the server could not be stored');
    // Sync health comes from its own live query: wait for it.
    await waitFor(() =>
      expect(status.closest('[role=status]')).toHaveAttribute('data-tone', 'warning'),
    );
    expect(screen.queryByText('Everything is synced.')).not.toBeInTheDocument();
  });

  it('the header chip says "Check sync" (amber), not "Needs review"', async () => {
    await db.sync_errors.add(pullProblem());
    renderAt('/settings');
    const link = await screen.findByRole('link', { name: /Sync status/ });
    await waitFor(() => expect(link).toHaveTextContent('Check sync'));
    expect(link).toHaveAttribute('data-tone', 'warning');
  });

  it('Urdu', async () => {
    await i18n.changeLanguage('ur');
    await db.sync_errors.add(pullProblem({ field: null }));
    renderAt('/sync');
    expect(await screen.findByText('اس ڈیوائس پر محفوظ نہیں')).toBeInTheDocument();
    expect(screen.getByText('یہ ریکارڈ پڑھا نہیں جا سکا۔')).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
