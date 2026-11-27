// Dropped database connections against naqdpos_test (run by `pnpm db:test`). Staging, 27 Nov
// 2026: "read ECONNRESET" from pg-pool in Better Auth findSession. Here the connection's server
// process is ended (pg_terminate_backend) at the worst moment, as a network drop would.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAuthPool } from './auth.ts';
import { createDb, withReadTx, withUserTx, type Tx } from './db/index.ts';
import { readRetryPool } from './db/pool.ts';
import { createLogger } from './logger.ts';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.TEST_DATABASE_URL!;

const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
const db = createDb(url, logger);
const context = { userId: null, deviceId: null };

/** Ends a server process from another connection (the same role may end its own sessions). */
async function terminate(pid: number) {
  const killer = new pg.Client({ connectionString: url });
  await killer.connect();
  try {
    await killer.query('select pg_terminate_backend($1)', [pid]);
  } finally {
    await killer.end();
  }
}
const pidOf = async (tx: Tx) =>
  Number((await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid);

afterAll(async () => {
  await db.destroy();
});

// These tests also end connections while a request holds them between queries: pg then emits
// 'error' on the client, which (without the wrapper's listener) is an unhandled error that
// crashes the API and fails this file.
describe('a connection that drops during a request', () => {
  it('a read transaction runs once more on a new connection', async () => {
    let attempts = 0;
    const value = await withReadTx({ db, logger }, context, async (tx) => {
      attempts += 1;
      if (attempts === 1) await terminate(await pidOf(tx));
      return (await sql<{ v: number }>`select 42 as v`.execute(tx)).rows[0]!.v;
    });
    expect(value).toBe(42);
    expect(attempts).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('retrying once'));
  });

  it('a write transaction is not retried: the error reaches the caller', async () => {
    let attempts = 0;
    await expect(
      withUserTx(db, context, async (tx) => {
        attempts += 1;
        await terminate(await pidOf(tx));
        await sql`select 1`.execute(tx);
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('a read-only transaction refuses writes (a mislabelled route fails loudly)', async () => {
    await expect(
      withReadTx({ db, logger }, context, (tx) =>
        sql`create temporary table t_readonly_check (x int)`.execute(tx),
      ),
    ).rejects.toMatchObject({ code: '25006' });
  });

  it('a dropped idle connection is logged, not a crash, and the pool carries on', async () => {
    const pool = createAuthPool(url, logger);
    try {
      const client = await pool.connect();
      const pid = Number(
        (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid,
      );
      client.release(); // idle in the pool now
      warn.mockClear();
      await terminate(pid);
      await vi.waitFor(() =>
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ pool: 'auth' }),
          'idle database connection dropped',
        ),
      );
      expect((await pool.query<{ v: number }>('select 1 as v')).rows[0]!.v).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('auth pool: a session lookup (a SELECT outside a transaction) is retried once', async () => {
    const pool = createAuthPool(url, logger);
    const wrapped = readRetryPool(pool, 'auth', logger);
    try {
      const client = await wrapped.connect();
      const pid = Number(
        (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid,
      );
      await terminate(pid);
      // The app context is set on the new connection too (the pool's startup options).
      const { rows } = await client.query<{ ctx: string }>(
        "select current_setting('app.context') as ctx",
      );
      expect(rows[0]!.ctx).toBe('auth');
      client.release();

      const writer = await wrapped.connect();
      const writerPid = Number(
        (await writer.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid,
      );
      await terminate(writerPid);
      await expect(writer.query('create temporary table t_retry_check (x int)')).rejects.toThrow();
      writer.release(true);
    } finally {
      await pool.end();
    }
  });
});
