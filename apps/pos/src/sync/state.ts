// Sync state kept on the device (Dexie `meta`), so the badge, banners and Sync screen read it
// with useLiveQuery and it survives a restart. Only the engine writes it.
import { SYNC_TABLE_NAMES, type SyncAuthProblem } from '@naqdpos/core';
import type { NaqdDb } from '../db/schema.ts';

export const SYNC_META = {
  CURSOR: 'sync_cursor',
  /** The sync tables this app knew when the cursor was built (see reconcileCursorTables). */
  CURSOR_TABLES: 'sync_cursor_tables',
  STATE: 'sync_state',
} as const;

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

/**
 * The pull cursor only says how far the device has read; rows of tables this app version did not
 * know were skipped on the way (architecture §4 Pull). When an update teaches the app a new table
 * (e.g. staff_pins), those rows lie behind the cursor and would never arrive. So the cursor is
 * stored together with the table names it was built with; if the app now knows a table that is
 * not in that set, the cursor goes back to 0 and the next pull reads everything again (pull is
 * idempotent, and rows with a pending local edit are never overwritten).
 * A device without a saved set but with a cursor (built before this check) is reset once.
 * Returns true when the cursor was reset.
 */
export async function reconcileCursorTables(
  database: NaqdDb,
  tables: readonly string[] = SYNC_TABLE_NAMES,
): Promise<boolean> {
  return database.transaction('rw', database.meta, async () => {
    const saved = (await database.meta.get(SYNC_META.CURSOR_TABLES))?.value;
    const known = Array.isArray(saved) ? new Set(saved as string[]) : null;
    const learned = known === null || tables.some((t) => !known.has(t));
    if (!learned) return false;
    const reset = (await readCursor(database)) > 0;
    if (reset) await database.meta.put({ key: SYNC_META.CURSOR, value: 0 });
    await database.meta.put({ key: SYNC_META.CURSOR_TABLES, value: [...tables].sort() });
    return reset;
  });
}
