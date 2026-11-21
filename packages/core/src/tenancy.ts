// Row shapes for the tenancy tables (architecture §3, migration 20261119120000_foundation.sql).
// Timestamps are ISO 8601 strings as they arrive in API JSON.
import type { Paisa } from './money.ts';

export const SHOP_TYPES = ['fruit_veg', 'grocery', 'meat', 'general'] as const;
export type ShopType = (typeof SHOP_TYPES)[number];

export const SHOP_STATUSES = ['active', 'suspended'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const ROLES = ['owner', 'cashier', 'rider'] as const;
export type Role = (typeof ROLES)[number];

/**
 * What a device may sync (architecture §4): `owner` = the owner's own phone (everything,
 * including owner-only tables); `shop` = shared counter (no owner-only tables); `rider`.
 * Default `shop`, so a device never gets owner-only data by accident.
 */
export const DEVICE_MODES = ['owner', 'shop', 'rider'] as const;
export type DeviceMode = (typeof DEVICE_MODES)[number];

export const DEFAULT_TIMEZONE = 'Asia/Karachi';
/** Rs 2,000 (architecture §3). */
export const DEFAULT_CASHIER_EXPENSE_LIMIT_PAISA: Paisa = 200_000;

/** Fields every synced, mutable row carries (architecture §2). */
interface SyncedMutable {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Assigned by the server; null until the row has been pulled back. */
  server_seq: number | null;
}

export interface ShopRow extends SyncedMutable {
  name: string;
  type: ShopType;
  address: string | null;
  phone: string | null;
  receipt_footer: string | null;
  logo_path: string | null;
  status: ShopStatus;
  plan_id: string | null;
  timezone: string;
  cashier_expense_limit_paisa: Paisa;
  /** A cashier's give-away per bill, as % of the paid lines' price (US032). Owners: no limit. */
  cashier_max_discount_pct: number;
  device_id: string | null;
}

/** Salary is not here: it lives in the owner-only `staff_salaries` table. */
export interface StaffRow extends SyncedMutable {
  shop_id: string;
  name: string;
  phone: string | null;
  role: Role;
  /** Always null since migration 20261120170000: PIN hashes live in staff_pins. Kept for old rows. */
  pin_hash: string | null;
  membership_user_id: string | null;
  active: boolean;
  device_id: string | null;
}

export interface DeviceRow extends SyncedMutable {
  shop_id: string;
  name: string;
  /** Receipt-number prefix, e.g. "A1" (architecture §4). */
  code: string;
  registered_by: string | null;
  last_sync_at: string | null;
  last_seq_pulled: number;
  mode: DeviceMode;
}

/** Owner-only (architecture §3): pulled and pushed only by devices in `owner` mode. */
export interface StaffSalaryRow {
  staff_id: string;
  shop_id: string;
  monthly_salary_paisa: Paisa;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
  server_seq: number | null;
}

/** A staff member's PIN hash (architecture §3). Only owner and shop devices hold these. */
export interface StaffPinRow {
  staff_id: string;
  shop_id: string;
  /** hashPin() output; the PIN itself never leaves the device that typed it. */
  pin_hash: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
  server_seq: number | null;
}
