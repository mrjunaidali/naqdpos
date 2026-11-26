// Local writes (CLAUDE.md rule 1, architecture §4): every write is ONE Dexie transaction that
// stores the row and its outbox entry, so a row is never saved without being queued for sync,
// and never queued without being saved. The sync engine pushes the outbox in the background.
import {
  SYNC_TABLES,
  toRetryEntry,
  uuidv7,
  type OutboxOp,
  type SyncTableName,
} from '@naqdpos/core';
import type { Table } from 'dexie';
import { readCurrentStaffId } from '../staff/currentStaff.ts';
import { db as defaultDb, type NaqdDb, type OutboxEntry } from './schema.ts';

export interface LocalWrite {
  table: SyncTableName;
  op: OutboxOp;
  row: Record<string, unknown>;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called after every committed local write; the sync engine debounces a push on it. */
export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function rowKey(table: SyncTableName, row: Record<string, unknown>): string {
  const key = row[SYNC_TABLES[table].key];
  if (typeof key !== 'string' || key === '') {
    throw new Error(`${table}: row has no ${SYNC_TABLES[table].key}`);
  }
  return `${table}:${key}`;
}

export function dataTable(database: NaqdDb, table: SyncTableName): Table<unknown, string> {
  return database.table(table);
}

export interface LocalWriteOptions {
  /**
   * Who is acting. Defaults to the current staff member; an owner screen opened with the owner's
   * PIN passes that owner, so sync_push's write_roles check sees the owner (architecture §4).
   */
  actorStaffId?: string | null;
}

/** Writes rows and their outbox entries in one transaction (all or nothing). Returns entry ids. */
export async function localWriteMany(
  writes: LocalWrite[],
  database: NaqdDb = defaultDb,
  options: LocalWriteOptions = {},
): Promise<string[]> {
  const actor =
    options.actorStaffId !== undefined ? options.actorStaffId : await readCurrentStaffId(database);
  const tables = [...new Set(writes.map((w) => w.table))].map((t) => dataTable(database, t));
  const ids = await database.transaction('rw', [...tables, database.outbox], async () => {
    const created: string[] = [];
    for (const write of writes) {
      if (!SYNC_TABLES[write.table].pushable) throw new Error(`${write.table} is pull-only`);
      // A new row has no server_seq until it comes back from the server.
      const row = { ...write.row, server_seq: write.row.server_seq ?? null };
      const entry: OutboxEntry = {
        id: uuidv7(),
        table: write.table,
        op: write.op,
        row,
        row_key: rowKey(write.table, row),
        created_at: new Date().toISOString(),
        attempts: 0,
        actor_staff_id: actor,
      };
      await dataTable(database, write.table).put(row);
      await database.outbox.add(entry);
      created.push(entry.id);
    }
    return created;
  });
  for (const listener of listeners) listener();
  return ids;
}

export async function localWrite(
  write: LocalWrite,
  database: NaqdDb = defaultDb,
  options: LocalWriteOptions = {},
): Promise<string> {
  const [id] = await localWriteMany([write], database, options);
  return id!;
}

/**
 * "Try again" on the Sync screen (owner only): moves rejected entries back into the outbox as
 * pending (toRetryEntry in core), in one transaction. Works offline: the entries simply wait in
 * the outbox; if the server rejects them again they return to sync_errors. The local row is not
 * touched, so a newer local edit of the same row stays as it is.
 */
export async function requeueRejected(
  ids: readonly string[],
  database: NaqdDb = defaultDb,
): Promise<number> {
  const moved = await database.transaction(
    'rw',
    [database.outbox, database.sync_errors],
    async () => {
      const rows = (await database.sync_errors.bulkGet([...ids])).filter(
        (row) => row !== undefined,
      );
      await database.outbox.bulkPut(rows.map((row) => toRetryEntry(row)));
      await database.sync_errors.bulkDelete(rows.map((row) => row.id));
      return rows.length;
    },
  );
  if (moved > 0) for (const listener of listeners) listener();
  return moved;
}
