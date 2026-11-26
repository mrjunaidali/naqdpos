import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DbUnavailableError, isRecoverableDbError, readWithRetry } from './retry.ts';

const opened: Dexie[] = [];
let n = 0;
function freshDb() {
  const database = new Dexie(`retry-${++n}`);
  database.version(1).stores({ items: 'id' });
  opened.push(database);
  return database;
}
afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close();
    await database.delete();
  }
});

const unknown = () => new DOMException('Unable to open cursor', 'UnknownError');

describe('isRecoverableDbError', () => {
  it('knows UnknownError, DatabaseClosedError and a lost connection, also wrapped by Dexie', () => {
    expect(isRecoverableDbError(unknown())).toBe(true);
    expect(isRecoverableDbError(new Dexie.DatabaseClosedError('closed'))).toBe(true);
    expect(
      isRecoverableDbError(
        new Error('Connection to Indexed Database server lost. Refresh the page.'),
      ),
    ).toBe(true);
    expect(isRecoverableDbError({ name: 'AbortError', inner: unknown() })).toBe(true);
    expect(isRecoverableDbError(new TypeError('x is undefined'))).toBe(false);
    expect(isRecoverableDbError(new Dexie.ConstraintError('dup'))).toBe(false);
  });
});

describe('readWithRetry', () => {
  it('returns the first result without touching the database', async () => {
    const database = freshDb();
    const close = vi.spyOn(database, 'close');
    await expect(readWithRetry(() => Promise.resolve(7), database)).resolves.toBe(7);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes and reopens once, then reads again', async () => {
    const database = freshDb();
    await database.table('items').put({ id: 'a' });
    const close = vi.spyOn(database, 'close');
    let calls = 0;
    const read = async () => {
      calls += 1;
      if (calls === 1) throw unknown();
      return database.table('items').toArray();
    };
    await expect(readWithRetry(read, database)).resolves.toEqual([{ id: 'a' }]);
    expect(calls).toBe(2);
    expect(close).toHaveBeenCalledOnce();
    expect(database.isOpen()).toBe(true);
  });

  it('a second failure becomes DbUnavailableError ("Please reload the app"); data stays', async () => {
    const database = freshDb();
    await database.table('items').put({ id: 'kept' });
    const read = () => Promise.reject(unknown());
    await expect(readWithRetry(read, database)).rejects.toBeInstanceOf(DbUnavailableError);
    expect(await database.table('items').toArray()).toEqual([{ id: 'kept' }]);
  });

  it('other errors are not retried', async () => {
    const database = freshDb();
    const read = vi.fn(() => Promise.reject(new TypeError('bug')));
    await expect(readWithRetry(read, database)).rejects.toThrow('bug');
    expect(read).toHaveBeenCalledOnce();
  });

  it('reads failing together share one reopen', async () => {
    const database = freshDb();
    const close = vi.spyOn(database, 'close');
    const failOnce = () => {
      let first = true;
      return () => {
        if (first) {
          first = false;
          return Promise.reject(unknown());
        }
        return Promise.resolve('ok');
      };
    };
    await expect(
      Promise.all([readWithRetry(failOnce(), database), readWithRetry(failOnce(), database)]),
    ).resolves.toEqual(['ok', 'ok']);
    expect(close).toHaveBeenCalledOnce();
  });
});
