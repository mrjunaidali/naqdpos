import { Dexie, type EntityTable } from 'dexie';

/** Device-local key/value settings (e.g. `storage_persisted`, architecture §6). Never synced. */
export interface MetaRow {
  key: string;
  value: unknown;
}

export const DB_NAME = 'naqdpos';

export class NaqdDb extends Dexie {
  // `declare` (not a class field) so the property doesn't overwrite the table Dexie sets up.
  declare meta: EntityTable<MetaRow, 'key'>;

  constructor(name: string = DB_NAME) {
    super(name);
    // Every schema change = a new version here plus a matching Supabase migration (CLAUDE.md rule 8).
    this.version(1).stores({
      meta: 'key',
    });
  }
}

export const db = new NaqdDb();
