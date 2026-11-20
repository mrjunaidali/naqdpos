// Synced tables, client side (architecture §4). The server's registry is the `sync_tables` table
// (db/migrations/20261120150000_sync.sql); a new synced table gets one row there and one entry
// here. The API validates pushed rows with `schema`; the app stores pulled rows by `key`.
import type { z } from 'zod';
import {
  DeviceRowSchema,
  ShopRowSchema,
  StaffRowSchema,
  StaffPinRowSchema,
  StaffSalaryRowSchema,
} from '../api/schemas.ts';

export interface SyncTableSpec {
  /** append = ledger (insert once); mutable = last write wins on updated_at. */
  kind: 'append' | 'mutable';
  /** Primary key column. */
  key: string;
  /** Devices may push rows (matches sync_tables.pushable). */
  pushable: boolean;
  /**
   * Which device modes pull and push it (matches sync_tables.pull_scope): owner_device = owner
   * only; counter_device = owner and shop devices (never riders).
   */
  scope: 'all' | 'owner_device' | 'counter_device';
  schema: z.ZodType<Record<string, unknown>, unknown>;
}

export const SYNC_TABLES = {
  shops: { kind: 'mutable', key: 'id', pushable: true, scope: 'all', schema: ShopRowSchema },
  staff: { kind: 'mutable', key: 'id', pushable: true, scope: 'all', schema: StaffRowSchema },
  staff_salaries: {
    kind: 'mutable',
    key: 'staff_id',
    pushable: true,
    scope: 'owner_device',
    schema: StaffSalaryRowSchema,
  },
  staff_pins: {
    kind: 'mutable',
    key: 'staff_id',
    pushable: true,
    scope: 'counter_device',
    schema: StaffPinRowSchema,
  },
  devices: { kind: 'mutable', key: 'id', pushable: false, scope: 'all', schema: DeviceRowSchema },
} as const satisfies Record<string, SyncTableSpec>;

export type SyncTableName = keyof typeof SYNC_TABLES;
export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES) as SyncTableName[];

/** Tables whose rows only owner-mode devices may hold (cleared when a device leaves owner mode). */
export const OWNER_DEVICE_TABLES = SYNC_TABLE_NAMES.filter(
  (name) => SYNC_TABLES[name].scope === 'owner_device',
);

export function isSyncTable(name: string): name is SyncTableName {
  return Object.hasOwn(SYNC_TABLES, name);
}
