import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { Database } from './types.ts';

export type { Database };
export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

// bigint (server_seq, *_paisa) stays a string: JS numbers lose precision above 2^53.
export function createDb(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
  });
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
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.user_id', ${context.userId ?? ''}, true),
                     set_config('app.device_id', ${context.deviceId ?? ''}, true)`.execute(tx);
    return fn(tx);
  });
}
