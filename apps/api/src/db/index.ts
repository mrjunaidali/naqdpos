import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import type { Logger } from '../logger.ts';
import { createPool, isConnectionError, readRetryPool } from './pool.ts';
import type { Database } from './types.ts';

export type { Database };
export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

// bigint (server_seq, *_paisa) stays a string: JS numbers lose precision above 2^53.
export function createDb(connectionString: string, logger?: Logger): Db {
  const pool = createPool(connectionString, { max: 10, name: 'app' }, logger);
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: readRetryPool(pool, 'app', logger) }),
  });
}

export interface TxOptions {
  /**
   * Only reads: the transaction is READ ONLY (a write fails in Postgres, so a mislabelled route
   * can't slip through) and is run once more when the database connection drops.
   */
  readOnly?: boolean;
  /**
   * Not read-only, but safe to run twice (the same result either way): retried once when the
   * connection drops. Only for idempotent work, e.g. the sync pull (its device mark is
   * last_seq_pulled = greatest(...)).
   */
  repeatable?: boolean;
  /** Logs the retry. */
  logger?: Logger | undefined;
}

/** Who is acting: the signed-in user and, when the request names one, the device. */
export interface TxContext {
  userId: string | null;
  deviceId?: string | null;
}

/**
 * Runs `fn` in one transaction as the given user (and device). RLS reads them through
 * current_user_id() / app.device_id, and `set_config(..., true)` is transaction-scoped, so
 * nothing leaks to the next request on the same pooled connection (safe with PgBouncer
 * transaction pooling too).
 */
export async function withUserTx<T>(
  db: Db,
  context: TxContext,
  fn: (tx: Tx) => Promise<T>,
  options: TxOptions = {},
): Promise<T> {
  const once = () => {
    const builder = db.transaction();
    return (options.readOnly ? builder.setAccessMode('read only') : builder).execute(async (tx) => {
      await sql`select set_config('app.user_id', ${context.userId ?? ''}, true),
                       set_config('app.device_id', ${context.deviceId ?? ''}, true)`.execute(tx);
      return fn(tx);
    });
  };
  if (!options.readOnly && !options.repeatable) return once();
  try {
    return await once();
  } catch (error) {
    // Writes are never retried: a write may have committed before the connection dropped.
    if (!isConnectionError(error)) throw error;
    options.logger?.warn(
      { err: error },
      'database connection dropped during a read or repeatable transaction: retrying once',
    );
    return once();
  }
}

/** A read-only transaction as the user, retried once if the connection drops (see TxOptions). */
export function withReadTx<T>(
  deps: { db: Db; logger?: Logger | undefined },
  context: TxContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withUserTx(deps.db, context, fn, { readOnly: true, logger: deps.logger });
}
