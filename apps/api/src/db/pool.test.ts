// The read-retry wrapper (staging 27 Nov 2026: "read ECONNRESET" in Better Auth findSession).
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { isConnectionError, readRetryPool } from './pool.ts';

const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

/** A fake pool: each client answers from `script` (an Error is thrown), shared across clients. */
function fakePool(script: (Error | string)[]) {
  const released: unknown[] = [];
  const queries: string[] = [];
  let clients = 0;
  const pool = {
    options: {},
    connect: vi.fn(() => {
      clients += 1;
      const client = {
        query: (text: string) => {
          queries.push(text);
          const next = script.shift() ?? 'ok';
          return next instanceof Error
            ? Promise.reject(next)
            : Promise.resolve({ rows: [{ v: next }], command: 'SELECT', rowCount: 1 });
        },
        release: (arg?: unknown) => released.push(arg),
        on: () => undefined,
        off: () => undefined,
      };
      return Promise.resolve(client);
    }),
    end: () => Promise.resolve(),
  };
  return {
    wrapped: readRetryPool(pool as unknown as pg.Pool, 'test'),
    released,
    queries,
    clients: () => clients,
  };
}

describe('isConnectionError', () => {
  it.each([
    [reset(), true],
    [Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }), true],
    [new Error('Connection terminated unexpectedly'), true],
    [new Error('Connection terminated'), true],
    [new Error('Client has encountered a connection error and is not queryable'), true],
    [
      Object.assign(new Error('terminating connection due to administrator command'), {
        code: '57P01',
      }),
      true,
    ],
    [Object.assign(new Error('connection failure'), { code: '08006' }), true],
    [Object.assign(new Error('duplicate key'), { code: '23505' }), false],
    [Object.assign(new Error('read-only transaction'), { code: '25006' }), false],
    [new Error('timeout exceeded when trying to connect'), false],
    ['ECONNRESET', false],
    [null, false],
  ])('%s → %s', (error, expected) => {
    expect(isConnectionError(error)).toBe(expected);
  });
});

describe('readRetryPool', () => {
  it('runs a SELECT once more on a new connection when the connection dropped', async () => {
    const pool = fakePool([reset(), 'second']);
    const client = await pool.wrapped.connect();
    const result = await client.query('select * from sessions where token = $1', ['t']);
    expect(result.rows).toEqual([{ v: 'second' }]);
    expect(pool.clients()).toBe(2);
    // The broken connection is destroyed (released with the error), not reused.
    expect(pool.released).toHaveLength(1);
    expect(pool.released[0]).toBeInstanceOf(Error);
    client.release();
    expect(pool.released).toHaveLength(2);
  });

  it('retries only once: a second drop is the error', async () => {
    const pool = fakePool([reset(), reset()]);
    const client = await pool.wrapped.connect();
    await expect(client.query('select 1', [])).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(pool.clients()).toBe(2);
  });

  it.each([
    'insert into sessions (id) values ($1)',
    'update sessions set expires_at = now()',
    'delete from verifications where id = $1',
    'with x as (delete from verifications returning id) select * from x',
    'select * from two_factors where user_id = $1 for update',
  ])('never retries a write or a locking read: %s', async (text) => {
    const pool = fakePool([reset()]);
    const client = await pool.wrapped.connect();
    await expect(client.query(text, [])).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(pool.clients()).toBe(1);
  });

  it('never retries inside a transaction (the transaction died with the connection)', async () => {
    const pool = fakePool(['begun', reset()]);
    const client = await pool.wrapped.connect();
    await client.query('begin', []);
    await expect(client.query('select 1', [])).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(pool.clients()).toBe(1);
  });

  it('retries again after the transaction ended', async () => {
    const pool = fakePool(['begun', 'done', reset(), 'after']);
    const client = await pool.wrapped.connect();
    await client.query('begin', []);
    await client.query('commit', []);
    expect((await client.query('select 1', [])).rows).toEqual([{ v: 'after' }]);
  });

  it('does not retry other errors', async () => {
    const pool = fakePool([Object.assign(new Error('permission denied'), { code: '42501' })]);
    const client = await pool.wrapped.connect();
    await expect(client.query('select 1', [])).rejects.toMatchObject({ code: '42501' });
    expect(pool.clients()).toBe(1);
  });
});
