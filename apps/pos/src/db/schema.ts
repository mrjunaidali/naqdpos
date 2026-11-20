import type {
  DeviceRow,
  OutboxOp,
  ShopRow,
  StaffRow,
  StaffSalaryRow,
  SyncTableName,
} from '@naqdpos/core';
import { Dexie, type EntityTable } from 'dexie';

/** Device-local key/value settings (e.g. `storage_persisted`, architecture §6). Never synced. */
export interface MetaRow {
  key: string;
  value: unknown;
}

/** A local write waiting to be pushed (architecture §4). Written in the same transaction as the row. */
export interface OutboxEntry {
  /** UUIDv7, so ordering by id is ordering by creation. */
  id: string;
  table: SyncTableName;
  op: OutboxOp;
  row: Record<string, unknown>;
  /** `${table}:${primary key}`: pull and conflict handling skip rows with a pending local edit. */
  row_key: string;
  created_at: string;
  attempts: number;
}

/** An outbox entry the server rejected (`sync_push` error), kept for review (architecture §7). */
export interface SyncErrorRow extends OutboxEntry {
  code: string;
  message: string | null;
  rejected_at: string;
}

export const DB_NAME = 'naqdpos';

export class NaqdDb extends Dexie {
  // `declare` (not a class field) so the property doesn't overwrite the table Dexie sets up.
  declare meta: EntityTable<MetaRow, 'key'>;
  declare shops: EntityTable<ShopRow, 'id'>;
  declare staff: EntityTable<StaffRow, 'id'>;
  declare devices: EntityTable<DeviceRow, 'id'>;
  declare staff_salaries: EntityTable<StaffSalaryRow, 'staff_id'>;
  declare outbox: EntityTable<OutboxEntry, 'id'>;
  declare sync_errors: EntityTable<SyncErrorRow, 'id'>;

  constructor(name: string = DB_NAME) {
    super(name);
    // Every schema change = a new version here plus a matching migration in db/migrations (CLAUDE.md rule 8).
    this.version(1).stores({
      meta: 'key',
    });
    // Tenancy tables (migration 20261119120000_foundation). Only what the device needs offline:
    // shop settings, staff for PIN switching, device codes. memberships, platform_admins and
    // audit_log are not stored on the device.
    // The session token and this device's registration live in `meta` (src/db/session.ts).
    // No index on staff.active: booleans are not valid IndexedDB keys; filter after shop_id.
    this.version(2).stores({
      shops: 'id, server_seq',
      staff: 'id, shop_id, server_seq',
      devices: 'id, shop_id, server_seq',
    });
    // Sync engine (migration 20261120150000_sync): the outbox, rejected entries, and
    // staff_salaries, which only owner-mode devices pull (and must clear when they leave it).
    this.version(3).stores({
      staff_salaries: 'staff_id, shop_id, server_seq',
      outbox: 'id, table, row_key',
      sync_errors: 'id, table',
    });
  }
}

export const db = new NaqdDb();
