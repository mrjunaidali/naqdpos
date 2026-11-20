import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiWithToken } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice, getStoredSession } from '../../db/session.ts';
import { patchSyncState, readSyncState } from '../../sync/state.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { me, resetDb, seedReady, shopRow, staffRow, USER_ID } from '../../test/fixtures.ts';
import { completeSignIn } from './completeSignIn.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
const syncNow = vi.hoisted(() => vi.fn(() => Promise.resolve('synced')));
vi.mock('../../sync/index.ts', () => ({ syncEngine: { syncNow } }));

const OTHER = '019a9b8e-0000-7000-8000-0000000000ff';
const signedIn = (id: string, email = 'x@shop.pk') => ({
  token: `token-${id}`,
  user: { id, email },
});

beforeEach(async () => {
  resetApiMock();
  syncNow.mockClear();
  vi.mocked(apiWithToken).mockClear();
  await resetDb();
});

async function pendingChange() {
  await db.outbox.add({
    id: '019a9b8e-0000-7000-8000-00000000aaaa',
    table: 'staff',
    op: 'upsert',
    row: { ...staffRow() },
    row_key: 'staff:x',
    created_at: new Date().toISOString(),
    attempts: 0,
    actor_staff_id: null,
  });
}

describe('re-sign-in on a set-up device (decision 4)', () => {
  it('same user: replaces the token, clears "sign in again", syncs; the device stays', async () => {
    await seedReady();
    await patchSyncState(db, { authProblem: 'auth_required' });
    await pendingChange();
    await expect(completeSignIn(signedIn(USER_ID, 'ali@shop.pk'))).resolves.toEqual({
      status: 'ok',
    });
    expect((await getStoredSession())?.token).toBe(`token-${USER_ID}`);
    expect(await getStoredDevice()).toBeDefined();
    expect((await readSyncState(db)).authProblem).toBeNull();
    expect(syncNow).toHaveBeenCalledOnce();
    expect(await db.outbox.count()).toBe(1);
  });

  it('another user while changes are waiting: refused, nothing replaced', async () => {
    await seedReady();
    await pendingChange();
    await expect(completeSignIn(signedIn(OTHER))).resolves.toEqual({
      status: 'unsynced',
      previousEmail: 'ali@shop.pk',
    });
    expect((await getStoredSession())?.user_id).toBe(USER_ID);
    expect(apiWithToken).not.toHaveBeenCalled();
  });

  it('another user of this shop with nothing waiting: accepted, checked with the new token', async () => {
    await seedReady();
    vi.mocked(api.me).mockResolvedValue(me([{ role: 'owner', shop: shopRow(), staff: null }]));
    await expect(completeSignIn(signedIn(OTHER))).resolves.toEqual({ status: 'ok' });
    expect(apiWithToken).toHaveBeenCalledWith(`token-${OTHER}`);
    expect((await getStoredSession())?.user_id).toBe(OTHER);
  });

  it('another user of a different shop: refused with the shop name', async () => {
    await seedReady();
    vi.mocked(api.me).mockResolvedValue(me([]));
    await expect(completeSignIn(signedIn(OTHER))).resolves.toEqual({
      status: 'other_shop',
      shopName: 'Ali Fruit',
    });
    expect((await getStoredSession())?.user_id).toBe(USER_ID);
  });

  it('after a sign-out (no session) the same rules apply', async () => {
    await seedReady();
    await db.meta.delete('session');
    await pendingChange();
    await expect(completeSignIn(signedIn(OTHER))).resolves.toEqual({
      status: 'unsynced',
      previousEmail: null,
    });
    expect(await getStoredSession()).toBeUndefined();
  });

  it('a first sign-in on a new device just saves the session', async () => {
    await expect(completeSignIn(signedIn(OTHER))).resolves.toEqual({ status: 'ok' });
    expect((await getStoredSession())?.user_id).toBe(OTHER);
  });
});
