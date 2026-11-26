// The sync engine (architecture §4, §7). Moves data between Dexie and the API in the background;
// nothing here is awaited by the selling flow (rule 1).
//
//   push: outbox in batches of 200 → accepted / conflicts leave the outbox (conflicts take the
//         server row), rejected entries move to sync_errors. Entries with a unit the server
//         does not list yet stay in the outbox unsent (deploy-order safeguard, bug 2026-11-25).
//   pull: pages from the stored cursor until has_more is false; stores the server's units, and
//         pushes again when they now let held entries through
//   triggers: start, `online`, a local write (debounced 5 s), every 60 s while online, Sync now
//   failures: network / server errors retry after 5 s, 15 s, 60 s, then every 5 min.
//             426 (update required), 401 (signed out) and 403 (device unlinked) pause sync with no
//             retries until the user acts; the outbox keeps every entry and selling goes on.
import {
  ApiError,
  isSyncTable,
  SYNC_PUSH_BATCH,
  SYNC_TABLE_NAMES,
  SYNC_TABLES,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTableSpec,
  unitServerLacks,
} from '@naqdpos/core';
import { dataTable, onLocalWrite, rowKey } from '../db/outbox.ts';
import type { NaqdDb, OutboxEntry } from '../db/schema.ts';
import {
  patchSyncState,
  readCursor,
  readServerUnits,
  readSyncState,
  reconcileCursorTables,
  SYNC_META,
} from './state.ts';

export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const;
export const WRITE_DEBOUNCE_MS = 5_000;
export const SYNC_INTERVAL_MS = 60_000;
/** How long a missing_parent entry is retried before it shows as an error. */
export const MISSING_PARENT_RETRY_MS = 24 * 60 * 60 * 1000;

export interface SyncApi {
  syncPush(input: SyncPushRequest): Promise<SyncPushResponse>;
  syncPull(input: SyncPullQuery): Promise<SyncPullResponse>;
}

type Handle = ReturnType<typeof setTimeout>;
export interface Timers {
  setTimeout(fn: () => void, ms: number): Handle;
  clearTimeout(handle: Handle): void;
  setInterval(fn: () => void, ms: number): Handle;
  clearInterval(handle: Handle): void;
}

export interface SyncEngineDeps {
  api: SyncApi;
  db: NaqdDb;
  appVersion: string;
  getDeviceId: () => Promise<string | null>;
  isOnline?: () => boolean;
  /** 426: run the service-worker update check at once (architecture §6). */
  onUpdateRequired?: () => void;
  /**
   * After a successful run; `pushed` = entries the server settled; `recovered` = the run before
   * was offline, failed or paused (for "Synced N records", architecture §7).
   */
  onSynced?: (pushed: number, recovered: boolean) => void;
  /** Where the `online` event comes from (window in the app). */
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  timers?: Timers;
}

export type SyncOutcome = 'synced' | 'offline' | 'paused' | 'failed' | 'not_registered';

export type SyncEngine = ReturnType<typeof createSyncEngine>;

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

export function createSyncEngine(deps: SyncEngineDeps) {
  const { api, db } = deps;
  const timers = deps.timers ?? defaultTimers;
  const isOnline = deps.isOnline ?? (() => true);

  let running: Promise<SyncOutcome> | null = null;
  let lastOutcome: SyncOutcome | null = null;
  let rerun = false;
  let failures = 0;
  let backoffTimer: Handle | null = null;
  let debounceTimer: Handle | null = null;
  let intervalTimer: Handle | null = null;
  let unsubscribeWrites: (() => void) | null = null;

  const dataTables = () => SYNC_TABLE_NAMES.map((name) => dataTable(db, name));

  /**
   * Stores server rows, except where a local edit is still waiting in the outbox: that edit is
   * newer on this device and will be pushed (and come back) itself.
   */
  async function applyServerRows(rows: { table: string; row: Record<string, unknown> }[]) {
    for (const { table, row } of rows) {
      if (!isSyncTable(table)) continue; // a table this app version does not know yet
      const parsed = SYNC_TABLES[table].schema.safeParse(row);
      if (!parsed.success) continue;
      const pending = await db.outbox.where('row_key').equals(rowKey(table, parsed.data)).count();
      if (pending === 0) await dataTable(db, table).put(parsed.data);
    }
  }

  async function settle(batch: OutboxEntry[], result: SyncPushResponse): Promise<number> {
    const byId = new Map(batch.map((entry) => [entry.id, entry]));
    const settled = new Set<string>();
    const now = new Date().toISOString();
    await db.transaction('rw', [db.outbox, db.sync_errors, ...dataTables()], async () => {
      for (const id of result.accepted) if (byId.has(id)) settled.add(id);
      for (const conflict of result.conflicts) if (byId.has(conflict.id)) settled.add(conflict.id);
      for (const error of result.errors) {
        const entry = byId.get(error.id);
        if (!entry) continue;
        // The parent row is not on the server yet: keep the entry and retry it next time. After a
        // day of retries it becomes a normal error, so it is still seen (architecture §4).
        if (
          error.code === 'missing_parent' &&
          Date.now() - Date.parse(entry.created_at) < MISSING_PARENT_RETRY_MS
        ) {
          continue;
        }
        settled.add(entry.id);
        await db.sync_errors.put({
          ...entry,
          code: error.code,
          message: error.message ?? null,
          field: error.field ?? null,
          rejected_at: now,
        });
      }
      await db.outbox.bulkDelete([...settled]);
      // The server kept its version: take it, or this device would keep the losing edit
      // forever (the server row's server_seq did not change, so pull would never resend it).
      await applyServerRows(result.conflicts);
      const unsettled = batch.filter((entry) => !settled.has(entry.id));
      await db.outbox.bulkPut(
        unsettled.map((entry) => ({ ...entry, attempts: entry.attempts + 1 })),
      );
    });
    return settled.size;
  }

  async function pushAll(deviceId: string): Promise<number> {
    let total = 0;
    const serverUnits = await readServerUnits(db);
    const sendable = (entry: OutboxEntry) => unitServerLacks(entry, serverUnits) === null;
    for (;;) {
      const batch = await db.outbox.orderBy('id').filter(sendable).limit(SYNC_PUSH_BATCH).toArray();
      if (batch.length === 0) return total;
      const result = await api.syncPush({
        device_id: deviceId,
        entries: batch.map(({ id, table, op, row, actor_staff_id }) => ({
          id,
          table,
          op,
          row,
          actor_staff_id: actor_staff_id ?? null,
        })),
      });
      const settled = await settle(batch, result);
      total += settled;
      if (settled === 0) return total; // nothing moved; don't spin on the same batch
    }
  }

  /** Returns true when the server's unit list changed (held entries may now go). */
  async function pullAll(deviceId: string): Promise<boolean> {
    // A table new to this app version means rows behind the cursor were skipped: re-pull.
    await reconcileCursorTables(db);
    let cursor = await readCursor(db);
    const unitsBefore = JSON.stringify(await readServerUnits(db));
    for (;;) {
      const page = await api.syncPull({ device_id: deviceId, since_seq: cursor });
      await db.transaction('rw', [db.outbox, db.meta, ...dataTables()], async () => {
        await applyServerRows(page.rows);
        await db.meta.put({ key: SYNC_META.CURSOR, value: page.next_seq });
        // An older API sends no units: back to the baseline, never a stale longer list.
        await db.meta.put({ key: SYNC_META.SERVER_UNITS, value: page.units ?? null });
      });
      if (!page.has_more || page.next_seq <= cursor) break;
      cursor = page.next_seq;
    }
    return JSON.stringify(await readServerUnits(db)) !== unitsBefore;
  }

  function clearBackoff() {
    if (backoffTimer !== null) timers.clearTimeout(backoffTimer);
    backoffTimer = null;
  }

  function scheduleBackoff() {
    clearBackoff();
    const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!;
    backoffTimer = timers.setTimeout(() => {
      backoffTimer = null;
      void run(false);
    }, delay);
  }

  async function syncOnce(manual: boolean): Promise<SyncOutcome> {
    const state = await readSyncState(db);
    // Paused until the user acts; only "Sync now" tries again.
    if (!manual && (state.updateRequired || state.authProblem)) return 'paused';
    if (!isOnline()) return 'offline';
    const deviceId = await deps.getDeviceId();
    if (!deviceId) return 'not_registered';

    try {
      let pushed = await pushAll(deviceId);
      if (await pullAll(deviceId)) pushed += await pushAll(deviceId);
      failures = 0;
      clearBackoff();
      await patchSyncState(db, {
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        authProblem: null,
        updateRequired: null,
      });
      deps.onSynced?.(pushed, lastOutcome !== null && lastOutcome !== 'synced');
      return 'synced';
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 426].includes(error.status)) {
        clearBackoff();
        if (error.status === 426) {
          await patchSyncState(db, {
            updateRequired: { minVersion: error.minVersion ?? null, appVersion: deps.appVersion },
          });
          deps.onUpdateRequired?.();
        } else {
          await patchSyncState(db, {
            authProblem: error.status === 401 ? 'auth_required' : 'device_unlinked',
          });
        }
        return 'paused';
      }
      failures += 1;
      scheduleBackoff();
      await patchSyncState(db, {
        lastError: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  }

  /** One run at a time; a trigger during a run queues exactly one more. */
  function run(manual: boolean): Promise<SyncOutcome> {
    if (running) {
      rerun = true;
      return running;
    }
    running = syncOnce(manual).then((outcome) => {
      // not_registered says nothing about the network; keep the previous outcome then
      if (outcome !== 'not_registered') lastOutcome = outcome;
      return outcome;
    });
    running = running.finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        void run(false);
      }
    });
    return running;
  }

  /** Automatic triggers wait while a backoff is pending (that is what backoff is for). */
  function autoRun() {
    if (backoffTimer === null) void run(false);
  }

  function notifyLocalWrite() {
    if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
    debounceTimer = timers.setTimeout(() => {
      debounceTimer = null;
      autoRun();
    }, WRITE_DEBOUNCE_MS);
  }

  const onOnline = () => {
    clearBackoff();
    void run(false);
  };

  /**
   * Entries refused as clock_ahead go back to the outbox once the user has fixed the clock:
   * timestamps still in the future (by this device's corrected clock) are set to now.
   */
  async function requeueClockErrors() {
    const now = new Date().toISOString();
    await db.transaction('rw', [db.outbox, db.sync_errors, ...dataTables()], async () => {
      const errors = await db.sync_errors.filter((e) => e.code === 'clock_ahead').toArray();
      for (const error of errors) {
        const { id, table, op, row_key, created_at, attempts, actor_staff_id } = error;
        const entry: OutboxEntry = {
          id,
          table,
          op,
          row: error.row,
          row_key,
          created_at,
          attempts,
          actor_staff_id,
        };
        const spec: SyncTableSpec = SYNC_TABLES[entry.table];
        const field = spec.kind === 'append' ? 'created_at' : 'updated_at';
        const stamp = entry.row[field];
        const row =
          typeof stamp === 'string' && stamp > now ? { ...entry.row, [field]: now } : entry.row;
        const newer = await db.outbox.where('row_key').equals(entry.row_key).count();
        await db.outbox.put({ ...entry, row });
        if (newer === 0) await dataTable(db, entry.table).put(row);
        await db.sync_errors.delete(entry.id);
      }
    });
  }

  return {
    async start() {
      const state = await readSyncState(db);
      // A reload to a new version clears "update required"; the next push tells if it still is.
      if (state.updateRequired && state.updateRequired.appVersion !== deps.appVersion) {
        await patchSyncState(db, { updateRequired: null });
      }
      unsubscribeWrites = onLocalWrite(notifyLocalWrite);
      deps.events?.addEventListener('online', onOnline);
      intervalTimer = timers.setInterval(() => {
        if (isOnline()) autoRun();
      }, SYNC_INTERVAL_MS);
      void run(false);
    },

    stop() {
      unsubscribeWrites?.();
      unsubscribeWrites = null;
      deps.events?.removeEventListener('online', onOnline);
      if (intervalTimer !== null) timers.clearInterval(intervalTimer);
      if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
      intervalTimer = debounceTimer = null;
      clearBackoff();
    },

    /** "Sync now": skips any backoff and also retries a paused sync. */
    async syncNow(): Promise<SyncOutcome> {
      clearBackoff();
      await requeueClockErrors();
      return run(true);
    },

    notifyLocalWrite,

    /** Resolves when no run is in progress (tests; a screen that wants to wait). */
    async whenIdle(): Promise<void> {
      while (running) await running;
    },
  };
}
