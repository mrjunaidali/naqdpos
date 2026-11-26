// Reopen-and-retry for heavy reads (bug 2026-11-25). iOS WebKit can drop the IndexedDB connection
// ("Connection to Indexed Database server lost", DatabaseClosedError) or fail a request with
// UnknownError; one close + reopen usually brings it back. A read that fails again surfaces as
// DbUnavailableError and the route's error screen asks to reload the app. Writes are not retried
// here: the outbox and the rows are already on disk, so nothing unsynced is lost either way.
import type Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { db as defaultDb } from './schema.ts';

/** The read failed again after reopening the database: the app needs a reload. */
export class DbUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The local database is not available. Please reload the app.', { cause });
    this.name = 'DbUnavailableError';
  }
}

const LOST = 'Connection to Indexed Database server lost';

function describe(error: unknown): { name: string; message: string } {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown };
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    return { name: text(e.name), message: text(e.message) };
  }
  return { name: '', message: String(error) };
}

/** An error a reopen may fix (Dexie wraps the DOMException; its `inner` is checked too). */
export function isRecoverableDbError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const { name, message } = describe(e);
    if (name === 'DatabaseClosedError' || name === 'UnknownError' || message.includes(LOST)) {
      return true;
    }
    e = (e as { inner?: unknown }).inner;
  }
  return false;
}

// Several live queries fail together when the connection drops: they share one reopen.
const reopening = new WeakMap<Dexie, Promise<void>>();

function reopen(database: Dexie): Promise<void> {
  let pending = reopening.get(database);
  if (!pending) {
    pending = (async () => {
      database.close({ disableAutoOpen: false });
      await database.open();
    })().finally(() => reopening.delete(database));
    reopening.set(database, pending);
  }
  return pending;
}

/** Runs `read`; on a recoverable IndexedDB error closes and reopens the database and runs it once more. */
export async function readWithRetry<T>(
  read: () => Promise<T>,
  database: Dexie = defaultDb,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isRecoverableDbError(error)) throw error;
    try {
      await reopen(database);
      return await read();
    } catch (again) {
      throw new DbUnavailableError(again);
    }
  }
}

/** useLiveQuery with readWithRetry around the querier (Day Close, reports, khata, Home). */
export function useRetryingLiveQuery<T>(
  querier: () => Promise<T>,
  deps: unknown[] = [],
): T | undefined {
  return useLiveQuery(() => readWithRetry(querier), deps);
}
