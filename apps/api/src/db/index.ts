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

/**
 * Runs `fn` in one transaction as `userId`. RLS reads the user through current_user_id(),
 * and `set_config(..., true)` is transaction-scoped, so it never leaks to the next request
 * on the same pooled connection (safe with PgBouncer transaction pooling too).
 */
export async function withUserTx<T>(
  db: Db,
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.user_id', ${userId ?? ''}, true)`.execute(tx);
    return fn(tx);
  });
}
