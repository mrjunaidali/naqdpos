// Sync state kept on the device (Dexie `meta`), so the badge, banners and Sync screen read it
// with useLiveQuery and it survives a restart. Only the engine writes it.
import type { SyncAuthProblem } from '@naqdpos/core';
import type { NaqdDb } from '../db/schema.ts';

export const SYNC_META = { CURSOR: 'sync_cursor', STATE: 'sync_state' } as const;

export interface SyncState {
  lastSyncAt: string | null;
  /** Set on 426 (architecture §4): sync paused until the app is reloaded to a newer version. */
  updateRequired: { minVersion: string | null; appVersion: string } | null;
  /** Set on 401 / 403: sync paused until the user signs in again or the device is re-linked. */
  authProblem: SyncAuthProblem | null;
  /** Last network or server failure (retried with backoff); null after a success. */
  lastError: string | null;
}

export const EMPTY_SYNC_STATE: SyncState = {
  lastSyncAt: null,
  updateRequired: null,
  authProblem: null,
  lastError: null,
};

export async function readSyncState(database: NaqdDb): Promise<SyncState> {
  const value = (await database.meta.get(SYNC_META.STATE))?.value as Partial<SyncState> | undefined;
  return { ...EMPTY_SYNC_STATE, ...value };
}

export async function patchSyncState(database: NaqdDb, patch: Partial<SyncState>): Promise<void> {
  await database.transaction('rw', database.meta, async () => {
    const current = await readSyncState(database);
    await database.meta.put({ key: SYNC_META.STATE, value: { ...current, ...patch } });
  });
}

export async function readCursor(database: NaqdDb): Promise<number> {
  const value = (await database.meta.get(SYNC_META.CURSOR))?.value;
  return typeof value === 'number' ? value : 0;
}
