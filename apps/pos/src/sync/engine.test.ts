import {
  ApiError,
  type StaffRow,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@naqdpos/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localWrite, localWriteMany } from '../db/outbox.ts';
import { NaqdDb } from '../db/schema.ts';
import { META_KEYS } from '../db/session.ts';
import { DEVICE_ID, SHOP_ID, staffRow } from '../test/fixtures.ts';
import {
  BACKOFF_MS,
  createSyncEngine,
  SYNC_INTERVAL_MS,
  WRITE_DEBOUNCE_MS,
  type SyncEngineDeps,
  type Timers,
} from './engine.ts';
import { readCursor, readSyncState } from './state.ts';

// --- helpers -------------------------------------------------------------------------------

const opened: NaqdDb[] = [];
let counter = 0;
function freshDb(): NaqdDb {
  const database = new NaqdDb(`naqdpos-engine-${++counter}`);
  opened.push(database);
  return database;
}
afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close();
    await database.delete();
  }
});

/** Timers the test fires by hand, so IndexedDB (which needs real timers) keeps working. */
function manualTimers() {
  let next = 1;
  const timeouts = new Map<number, { fn: () => void; ms: number }>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      timeouts.set(next, { fn, ms });
      return next++;
    },
    clearTimeout: (h) => void timeouts.delete(h),
    setInterval: (fn, ms) => {
      intervals.set(next, { fn, ms });
      return next++;
    },
    clearInterval: (h) => void intervals.delete(h),
  };
  return {
    timers,
    /** Delays of the one-shot timers waiting to fire. */
    pending: () => [...timeouts.values()].map((t) => t.ms),
    intervals: () => [...intervals.values()].map((t) => t.ms),
    /** Fires every pending one-shot timer with this delay. */
    fire(ms: number) {
      for (const [id, t] of [...timeouts]) {
        if (t.ms === ms) {
          timeouts.delete(id);
          t.fn();
        }
      }
    },
    tickIntervals() {
      for (const t of intervals.values()) t.fn();
    },
  };
}

const STAFF = (n: number) => `019a9b8e-0000-7000-8000-${String(n).padStart(12, '0')}`;

function staff(n: number, overrides: Partial<StaffRow> = {}): StaffRow {
  return staffRow({
    id: STAFF(n),
    role: 'cashier',
    name: `Staff ${n}`,
    server_seq: null,
    ...overrides,
  });
}

/** A tiny in-memory server: accepts everything, numbers rows, pages pulls. */
function fakeServer(pageSize = 2) {
  let seq = 0;
  const rows: { table: string; row: Record<string, unknown>; server_seq: number }[] = [];
  const syncPush = vi.fn((req: SyncPushRequest): Promise<SyncPushResponse> => {
    for (const entry of req.entries) {
      seq += 1;
      rows.push({ table: entry.table, row: { ...entry.row, server_seq: seq }, server_seq: seq });
    }
    return Promise.resolve({ accepted: req.entries.map((e) => e.id), conflicts: [], errors: [] });
  });
  const syncPull = vi.fn((q: SyncPullQuery): Promise<SyncPullResponse> => {
    const newer = rows.filter((r) => r.server_seq > q.since_seq);
    const page = newer.slice(0, pageSize);
    return Promise.resolve({
      rows: page,
      next_seq: page.at(-1)?.server_seq ?? q.since_seq,
      has_more: newer.length > pageSize,
    });
  });
  return { api: { syncPush, syncPull }, rows };
}

function setup(overrides: Partial<SyncEngineDeps> = {}) {
  const db = freshDb();
  const clock = manualTimers();
  const server = fakeServer();
  const events = new EventTarget();
  const onUpdateRequired = vi.fn();
  const deps: SyncEngineDeps = {
    api: server.api,
    db,
    appVersion: '1.0.0',
    getDeviceId: () => Promise.resolve(DEVICE_ID),
    isOnline: () => true,
    onUpdateRequired,
    events,
    timers: clock.timers,
    ...overrides,
  };
  const engine = createSyncEngine(deps);
  return { db, clock, server, events, onUpdateRequired, engine, deps };
}

const write = (db: NaqdDb, n: number, overrides: Partial<StaffRow> = {}) =>
  localWrite({ table: 'staff', op: 'upsert', row: { ...staff(n, overrides) } }, db);

// --- tests ---------------------------------------------------------------------------------

describe('sync engine: push and pull', () => {
  it('pushes in batches of 200, then pulls page by page until empty', async () => {
    const { db, server, engine } = setup();
    await localWriteMany(
      Array.from({ length: 450 }, (_, i) => ({
        table: 'staff' as const,
        op: 'upsert' as const,
        row: { ...staff(i + 1) },
      })),
      db,
    );

    server.api.syncPull.mockImplementation((q) => {
      // 3 pages of 2 rows from the server's own list.
      const all = [1, 2, 3, 4, 5].map((n) => ({
        table: 'staff',
        row: { ...staff(1000 + n), server_seq: n },
        server_seq: n,
      }));
      const newer = all.filter((r) => r.server_seq > q.since_seq).slice(0, 2);
      return Promise.resolve({
        rows: newer,
        next_seq: newer.at(-1)?.server_seq ?? q.since_seq,
        has_more: (newer.at(-1)?.server_seq ?? 5) < 5,
      });
    });

    await expect(engine.syncNow()).resolves.toBe('synced');
    expect(server.api.syncPush.mock.calls.map(([req]) => req.entries.length)).toEqual([
      200, 200, 50,
    ]);
    expect(server.api.syncPush.mock.calls[0]![0].device_id).toBe(DEVICE_ID);
    expect(await db.outbox.count()).toBe(0);
    expect(server.api.syncPull.mock.calls.map(([q]) => q.since_seq)).toEqual([0, 2, 4]);
    expect(await readCursor(db)).toBe(5);
    expect(await db.staff.get(STAFF(1005))).toMatchObject({ server_seq: 5 });
    expect((await readSyncState(db)).lastSyncAt).not.toBeNull();
  });

  it('moves rejected entries to sync_errors and removes them from the outbox', async () => {
    const { db, server, engine } = setup();
    const ok = await write(db, 1);
    const bad = await write(db, 2);
    server.api.syncPush.mockResolvedValueOnce({
      accepted: [ok],
      conflicts: [],
      errors: [{ id: bad, code: 'clock_ahead' }],
    });
    await engine.syncNow();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sync_errors.get(bad)).toMatchObject({
      code: 'clock_ahead',
      message: null,
      row_key: `staff:${STAFF(2)}`,
    });
  });

  it('takes the server row after a conflict, so the device converges', async () => {
    const { db, server, engine } = setup();
    const entry = await write(db, 1, { name: 'Losing local edit' });
    const serverRow = { ...staff(1, { name: 'Server wins' }), server_seq: 41 };
    server.api.syncPush.mockResolvedValueOnce({
      accepted: [],
      conflicts: [{ id: entry, table: 'staff', row: serverRow }],
      errors: [],
    });
    server.api.syncPull.mockResolvedValue({ rows: [], next_seq: 0, has_more: false });

    await expect(engine.syncNow()).resolves.toBe('synced');
    expect(await db.outbox.count()).toBe(0);
    expect(await db.staff.get(STAFF(1))).toMatchObject({ name: 'Server wins', server_seq: 41 });
  });

  it('does not let a pull overwrite a row that still has a local edit waiting', async () => {
    const { db, server, engine } = setup();
    await write(db, 1, { name: 'Local edit' });
    server.api.syncPush.mockRejectedValueOnce(new ApiError(500, 'internal'));
    await engine.syncNow(); // push fails: the edit stays in the outbox

    server.api.syncPush.mockResolvedValueOnce({ accepted: [], conflicts: [], errors: [] });
    server.api.syncPull.mockResolvedValueOnce({
      rows: [
        {
          table: 'staff',
          row: { ...staff(1, { name: 'Older server copy' }), server_seq: 7 },
          server_seq: 7,
        },
      ],
      next_seq: 7,
      has_more: false,
    });
    await engine.syncNow();
    expect(await db.staff.get(STAFF(1))).toMatchObject({ name: 'Local edit' });
    expect(await readCursor(db)).toBe(7);
  });

  it('skips tables this app version does not know', async () => {
    const { db, server, engine } = setup();
    server.api.syncPull.mockResolvedValueOnce({
      rows: [{ table: 'future_table', row: { id: 'x' }, server_seq: 3 }],
      next_seq: 3,
      has_more: false,
    });
    await expect(engine.syncNow()).resolves.toBe('synced');
    expect(await readCursor(db)).toBe(3);
  });

  it('does nothing offline or before the device is registered', async () => {
    const offline = setup({ isOnline: () => false });
    await expect(offline.engine.syncNow()).resolves.toBe('offline');
    const unregistered = setup({ getDeviceId: () => Promise.resolve(null) });
    await expect(unregistered.engine.syncNow()).resolves.toBe('not_registered');
    expect(offline.server.api.syncPush).not.toHaveBeenCalled();
    expect(unregistered.server.api.syncPush).not.toHaveBeenCalled();
  });
});

describe('sync engine: triggers and backoff', () => {
  it('syncs on start, every 60 s while online, and on the online event', async () => {
    const { server, engine, clock, events } = setup();
    await engine.start();
    await engine.whenIdle();
    expect(server.api.syncPull).toHaveBeenCalledTimes(1);
    expect(clock.intervals()).toEqual([SYNC_INTERVAL_MS]);

    clock.tickIntervals();
    await engine.whenIdle();
    expect(server.api.syncPull).toHaveBeenCalledTimes(2);

    events.dispatchEvent(new Event('online'));
    await engine.whenIdle();
    expect(server.api.syncPull).toHaveBeenCalledTimes(3);
    engine.stop();
    expect(clock.intervals()).toEqual([]);
  });

  it('debounces local writes by 5 s into one push', async () => {
    const { db, server, engine, clock } = setup();
    await engine.start();
    await engine.whenIdle();
    await write(db, 1);
    await write(db, 2);
    expect(clock.pending()).toEqual([WRITE_DEBOUNCE_MS]);
    clock.fire(WRITE_DEBOUNCE_MS);
    await engine.whenIdle();
    expect(server.api.syncPush).toHaveBeenCalledTimes(1);
    expect(server.api.syncPush.mock.calls[0]![0].entries).toHaveLength(2);
    engine.stop();
  });

  it('backs off 5 s, 15 s, 60 s, then every 5 min, and resets after a success', async () => {
    const { db, server, engine, clock } = setup();
    await write(db, 1);
    server.api.syncPush.mockRejectedValue(new ApiError(0, 'network'));

    await expect(engine.syncNow()).resolves.toBe('failed');
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const [delay] = clock.pending();
      seen.push(delay!);
      clock.fire(delay!);
      await engine.whenIdle();
    }
    expect(seen).toEqual([...BACKOFF_MS, 300_000]);
    expect(await db.outbox.count()).toBe(1);
    expect((await readSyncState(db)).lastError).toBeTruthy();

    server.api.syncPush.mockReset();
    server.api.syncPush.mockResolvedValue({ accepted: [], conflicts: [], errors: [] });
    const [delay] = clock.pending();
    clock.fire(delay!);
    await engine.whenIdle();
    expect(clock.pending()).toEqual([]);
    expect((await readSyncState(db)).lastError).toBeNull();
  });

  it('does not let the 60 s tick skip a pending backoff', async () => {
    const { db, server, engine, clock } = setup();
    await write(db, 1);
    server.api.syncPush.mockRejectedValue(new ApiError(503, 'internal'));
    await engine.start();
    await engine.whenIdle();
    expect(server.api.syncPush).toHaveBeenCalledTimes(1);
    clock.tickIntervals();
    await engine.whenIdle();
    expect(server.api.syncPush).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});

describe('sync engine: paused states (no retries, outbox kept, selling goes on)', () => {
  it('426: pauses sync, keeps the outbox, asks for the update check, and local writes still work', async () => {
    const { db, server, engine, clock, onUpdateRequired } = setup();
    await write(db, 1);
    server.api.syncPush.mockRejectedValue(
      new ApiError(426, 'upgrade_required', undefined, '2.0.0'),
    );

    await engine.start();
    await engine.whenIdle();
    expect(await readSyncState(db)).toMatchObject({
      updateRequired: { minVersion: '2.0.0', appVersion: '1.0.0' },
    });
    expect(onUpdateRequired).toHaveBeenCalledOnce();
    expect(clock.pending()).toEqual([]); // no backoff retry
    expect(await db.outbox.count()).toBe(1);

    // Selling keeps writing locally; automatic triggers do not call the API.
    await write(db, 2);
    expect(await db.outbox.count()).toBe(2);
    clock.fire(WRITE_DEBOUNCE_MS);
    clock.tickIntervals();
    await engine.whenIdle();
    expect(server.api.syncPush).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('426: a reload to a new version clears the flag and pushes the waiting outbox', async () => {
    const first = setup();
    await write(first.db, 1);
    first.server.api.syncPush.mockRejectedValueOnce(new ApiError(426, 'upgrade_required'));
    await first.engine.syncNow();
    expect((await readSyncState(first.db)).updateRequired).not.toBeNull();

    // Same device database, new build.
    const server = fakeServer();
    const reloaded = createSyncEngine({ ...first.deps, api: server.api, appVersion: '2.0.0' });
    await reloaded.start();
    await reloaded.whenIdle();
    expect(server.api.syncPush).toHaveBeenCalledTimes(1);
    expect(await first.db.outbox.count()).toBe(0);
    expect((await readSyncState(first.db)).updateRequired).toBeNull();
    reloaded.stop();
  });

  it.each([
    [401, 'auth_required'],
    [403, 'device_unlinked'],
  ] as const)(
    '%i: pauses with %s, never signs out, retries only on Sync now',
    async (status, problem) => {
      const { db, server, engine, clock } = setup();
      await db.meta.put({ key: META_KEYS.SESSION, value: { token: 't' } });
      await write(db, 1);
      server.api.syncPush.mockRejectedValueOnce(new ApiError(status, 'x'));

      await engine.start();
      await engine.whenIdle();
      expect((await readSyncState(db)).authProblem).toBe(problem);
      expect(clock.pending()).toEqual([]);
      expect(await db.outbox.count()).toBe(1);
      expect(await db.meta.get(META_KEYS.SESSION)).toBeDefined();

      clock.tickIntervals();
      await engine.whenIdle();
      expect(server.api.syncPush).toHaveBeenCalledTimes(1);

      // Signed in again / re-linked: "Sync now" tries, succeeds and clears the problem.
      await expect(engine.syncNow()).resolves.toBe('synced');
      expect((await readSyncState(db)).authProblem).toBeNull();
      expect(await db.outbox.count()).toBe(0);
      engine.stop();
    },
  );
});

describe('sync engine: clock_ahead', () => {
  it('Sync now re-queues clock_ahead entries with future timestamps set to now', async () => {
    const { db, server, engine } = setup();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const entry = await write(db, 1, { updated_at: future });
    server.api.syncPush.mockResolvedValueOnce({
      accepted: [],
      conflicts: [],
      errors: [{ id: entry, code: 'clock_ahead' }],
    });
    await engine.syncNow();
    expect(await db.sync_errors.count()).toBe(1);

    await engine.syncNow();
    expect(await db.sync_errors.count()).toBe(0);
    const pushed = server.api.syncPush.mock.calls[1]![0].entries[0]!;
    expect(pushed.id).toBe(entry);
    expect(String(pushed.row.updated_at) < future).toBe(true);
    expect((await db.staff.get(STAFF(1)))?.updated_at).toBe(pushed.row.updated_at);
    expect(SHOP_ID).toBeTruthy();
  });
});

describe('sync engine: acting staff', () => {
  it('sends each entry with the staff member who made it (write_roles check)', async () => {
    const { db, server, engine } = setup();
    const owner = '019a9b8e-0000-7000-8000-0000000000a1';
    await localWrite({ table: 'staff', op: 'upsert', row: { ...staff(1) } }, db, {
      actorStaffId: owner,
    });
    await engine.syncNow();
    expect(server.api.syncPush.mock.calls[0]![0].entries[0]).toMatchObject({
      actor_staff_id: owner,
    });
  });
});
