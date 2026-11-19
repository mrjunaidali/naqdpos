// Database rows → API JSON (DeviceRow/ShopRow/StaffRow in packages/core). pg returns bigint as a
// string and timestamptz as a Date; the device rows use numbers and ISO strings. These bigints
// (server_seq, paisa limits, cursors) stay far below 2^53.
import type { DeviceRow, ShopRow, StaffRow } from '@naqdpos/core';
import type { Selectable } from 'kysely';
import type { DevicesTable, ShopsTable, StaffTable } from './types.ts';

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);
const isoOrNull = (d: Date | string | null) => (d === null ? null : iso(d));

export function toShopRow(r: Selectable<ShopsTable>): ShopRow {
  return {
    ...r,
    cashier_expense_limit_paisa: Number(r.cashier_expense_limit_paisa),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    deleted_at: isoOrNull(r.deleted_at),
    server_seq: Number(r.server_seq),
  };
}

export function toStaffRow(r: Selectable<StaffTable>): StaffRow {
  return {
    ...r,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    deleted_at: isoOrNull(r.deleted_at),
    server_seq: Number(r.server_seq),
  };
}

export function toDeviceRow(r: Selectable<DevicesTable>): DeviceRow {
  return {
    ...r,
    last_sync_at: isoOrNull(r.last_sync_at),
    last_seq_pulled: Number(r.last_seq_pulled),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    deleted_at: isoOrNull(r.deleted_at),
    server_seq: Number(r.server_seq),
  };
}
