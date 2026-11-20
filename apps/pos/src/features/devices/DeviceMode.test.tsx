import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { readCursor, SYNC_META } from '../../sync/state.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import {
  deviceRow,
  resetDb,
  seedPin,
  seedReady,
  SHOP_ID,
  STAFF_ID,
  staffRow,
} from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { UnsyncedChangesError } from '../settings/signOut.ts';
import { changeDeviceMode } from './deviceMode.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
const syncNow = vi.hoisted(() => vi.fn(() => Promise.resolve('synced')));
vi.mock('../../sync/index.ts', () => ({ syncEngine: { syncNow } }));

const mocked = vi.mocked(api);
const NOW = '2026-11-21T10:00:00.000Z';

beforeEach(async () => {
  resetApiMock();
  syncNow.mockClear();
  await resetDb();
  mocked.setDeviceMode.mockImplementation((_id: string, mode: 'owner' | 'shop') =>
    Promise.resolve(deviceRow({ mode, server_seq: 50 })),
  );
});

async function seedOwnerOnlyRows() {
  await db.staff_salaries.put({
    staff_id: STAFF_ID,
    shop_id: SHOP_ID,
    monthly_salary_paisa: 3_000_000,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    device_id: null,
    server_seq: 7,
  });
  await db.product_costs.put({
    product_id: 'p1',
    shop_id: SHOP_ID,
    cost_price_paisa: 6000,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    device_id: null,
    server_seq: 8,
  });
  await db.product_cost_history.put({
    id: 'h1',
    shop_id: SHOP_ID,
    product_id: 'p1',
    cost_price_paisa: 6000,
    effective_at: NOW,
    created_at: NOW,
    device_id: null,
    server_seq: 9,
  });
}

describe('changeDeviceMode', () => {
  it('shop → owner: server first, then mode in meta and devices, pull cursor reset, sync', async () => {
    await seedReady('shop');
    await db.meta.put({ key: SYNC_META.CURSOR, value: 120 });
    await changeDeviceMode('owner');
    expect(mocked.setDeviceMode).toHaveBeenCalledWith(deviceRow().id, 'owner');
    expect((await getStoredDevice())?.mode).toBe('owner');
    expect((await db.devices.get(deviceRow().id))?.mode).toBe('owner');
    // Owner-only rows were never pulled as a shop device: start the pull from the beginning.
    expect(await readCursor(db)).toBe(0);
    expect(syncNow).toHaveBeenCalledOnce();
  });

  it('owner → shop: empties every owner-only store and resets the cursor; the rest stays', async () => {
    await seedReady('owner');
    await seedOwnerOnlyRows();
    await db.meta.put({ key: SYNC_META.CURSOR, value: 120 });
    await changeDeviceMode('shop');
    expect(await db.staff_salaries.count()).toBe(0);
    expect(await db.product_costs.count()).toBe(0);
    expect(await db.product_cost_history.count()).toBe(0);
    expect(await db.staff.count()).toBe(1);
    expect((await getStoredDevice())?.mode).toBe('shop');
    expect(await readCursor(db)).toBe(0);
  });

  it('refuses while changes wait to sync, without asking the server', async () => {
    await seedReady('owner');
    await db.outbox.add({
      id: 'e1',
      table: 'staff',
      op: 'upsert',
      row: { ...staffRow() },
      row_key: 'staff:x',
      created_at: NOW,
      attempts: 0,
      actor_staff_id: STAFF_ID,
    });
    await expect(changeDeviceMode('shop')).rejects.toBeInstanceOf(UnsyncedChangesError);
    expect(mocked.setDeviceMode).not.toHaveBeenCalled();
    expect((await getStoredDevice())?.mode).toBe('owner');
  });

  it('changes nothing on the device when the server refuses or is unreachable', async () => {
    await seedReady('owner');
    await seedOwnerOnlyRows();
    await db.meta.put({ key: SYNC_META.CURSOR, value: 120 });
    mocked.setDeviceMode.mockRejectedValueOnce(new ApiError(0, 'network'));
    await expect(changeDeviceMode('shop')).rejects.toBeInstanceOf(ApiError);
    expect((await getStoredDevice())?.mode).toBe('owner');
    expect(await db.product_costs.count()).toBe(1);
    expect(await readCursor(db)).toBe(120);
  });
});

describe('Settings → Device mode', () => {
  it('is offered to owners only', async () => {
    await seedReady('owner');
    renderAt('/settings');
    expect(await screen.findByRole('link', { name: 'Device mode' })).toBeInTheDocument();
  });

  it('is hidden from a cashier', async () => {
    await seedReady('owner');
    const cashier = '019a9b8e-0000-7000-8000-0000000000c2';
    await db.staff.put(
      staffRow({ id: cashier, name: 'Bilal', role: 'cashier', membership_user_id: null }),
    );
    await writeCurrentStaffId(cashier);
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('link', { name: 'Device mode' })).toBeNull();
  });

  it('asks for the owner PIN on a shop device, then switches to owner phone', async () => {
    await seedReady('shop');
    await seedPin(STAFF_ID, '4821');
    renderAt('/settings/device');
    await screen.findByRole('heading', { name: 'Owner PIN needed' });
    for (const d of '4821') fireEvent.click(await screen.findByRole('button', { name: d }));
    await screen.findByRole('heading', { name: 'Device mode' });
    fireEvent.click(screen.getByRole('radio', { name: /My own phone/ }));
    const change = screen.getByRole('button', { name: 'Change mode' });
    await waitFor(() => expect(change).toBeEnabled());
    fireEvent.click(change);
    expect(await screen.findByText(/Mode changed/)).toBeInTheDocument();
    expect((await getStoredDevice())?.mode).toBe('owner');
  });

  it('shows "Sync first" with Sync now while changes wait', async () => {
    await seedReady('owner');
    await db.outbox.add({
      id: 'e2',
      table: 'staff',
      op: 'upsert',
      row: { ...staffRow() },
      row_key: 'staff:y',
      created_at: NOW,
      attempts: 0,
      actor_staff_id: STAFF_ID,
    });
    renderAt('/settings/device');
    expect(await screen.findByText(/Sync first, then change the mode/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change mode' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
  });
});
