import type { DeviceRow, ShopRow, StaffRow } from '@naqdpos/core';
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
  declare shops: EntityTable<ShopRow, 'id'>;
  declare staff: EntityTable<StaffRow, 'id'>;
  declare devices: EntityTable<DeviceRow, 'id'>;

  constructor(name: string = DB_NAME) {
    super(name);
    // Every schema change = a new version here plus a matching migration in db/migrations (CLAUDE.md rule 8).
    this.version(1).stores({
      meta: 'key',
    });
    // Tenancy tables (migration 20261119120000_foundation). Only what the device needs offline:
    // shop settings, staff for PIN switching, device codes. memberships, staff_salaries
    // (owner-only), platform_admins and audit_log are not stored on the device.
    // The session token and this device's registration live in `meta` (src/db/session.ts).
    // No index on staff.active: booleans are not valid IndexedDB keys; filter after shop_id.
    this.version(2).stores({
      shops: 'id, server_seq',
      staff: 'id, shop_id, server_seq',
      devices: 'id, shop_id, server_seq',
    });
  }
}

export const db = new NaqdDb();
