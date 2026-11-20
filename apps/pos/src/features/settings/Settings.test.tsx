import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice, getStoredSession } from '../../db/session.ts';
import { patchSyncState } from '../../sync/state.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedReady, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { signOutOnDevice, UnsyncedChangesError } from './signOut.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
const syncNow = vi.hoisted(() => vi.fn(() => Promise.resolve('synced')));
vi.mock('../../sync/index.ts', () => ({ syncEngine: { syncNow } }));

beforeEach(async () => {
  resetApiMock();
  syncNow.mockClear();
  await resetDb();
  await seedReady();
});

async function pendingChange() {
  await db.outbox.add({
    id: '019a9b8e-0000-7000-8000-00000000aaab',
    table: 'staff',
    op: 'upsert',
    row: { ...staffRow() },
    row_key: 'staff:y',
    created_at: new Date().toISOString(),
    attempts: 0,
    actor_staff_id: null,
  });
}

describe('sign out (§7 guarded action)', () => {
  it('is blocked while changes wait to sync, and offers Sync now', async () => {
    await pendingChange();
    renderAt('/settings');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '1 change is not synced yet. Sync before signing out.',
    );
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
    await expect(signOutOnDevice()).rejects.toBeInstanceOf(UnsyncedChangesError);
    expect(await getStoredSession()).toBeDefined();
  });

  it('signs out when everything is synced; the device registration stays', async () => {
    vi.mocked(api.signOut).mockResolvedValue({ success: true });
    const { router } = renderAt('/settings');
    const button = await screen.findByRole('button', { name: 'Sign out' });
    await waitFor(() => expect(button).toBeEnabled()); // enabled once the outbox count is known
    fireEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(await getStoredSession()).toBeUndefined();
    expect(await getStoredDevice()).toBeDefined();
    expect(api.signOut).toHaveBeenCalledOnce();
  });

  it('signs out offline too (the server call may fail)', async () => {
    vi.mocked(api.signOut).mockRejectedValue(new Error('offline'));
    await signOutOnDevice();
    expect(await getStoredSession()).toBeUndefined();
  });
});

describe('Sync screen: Sign in again', () => {
  it('offers sign-in without leaving the shop when the session ended', async () => {
    await patchSyncState(db, { authProblem: 'auth_required' });
    const { router } = renderAt('/sync');
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in again' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(await getStoredSession()).toBeDefined();
  });

  it('keeps /sign-in closed on a ready device whose session is fine', async () => {
    const { router } = renderAt('/sign-in');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
