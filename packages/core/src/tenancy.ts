// Row shapes for the tenancy tables (architecture §3, migration 20261118200000_tenancy.sql).
// Timestamps are ISO 8601 strings as they arrive from PostgREST/RPC JSON.
import type { Paisa } from './money.ts';

export const SHOP_TYPES = ['fruit_veg', 'grocery', 'meat', 'general'] as const;
export type ShopType = (typeof SHOP_TYPES)[number];

export const SHOP_STATUSES = ['active', 'suspended'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const ROLES = ['owner', 'cashier', 'rider'] as const;
export type Role = (typeof ROLES)[number];

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
  device_id: string | null;
}

/** Salary is not here: it lives in the owner-only `staff_salaries` table. */
export interface StaffRow extends SyncedMutable {
  shop_id: string;
  name: string;
  phone: string | null;
  role: Role;
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
}
