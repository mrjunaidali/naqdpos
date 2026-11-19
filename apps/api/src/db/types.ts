// Kysely table types for the columns the API touches (migration 20261119120000_foundation).
// Hand-written; extend them as routes need more tables.
import type { ColumnType, Generated } from 'kysely';
import type { Role, ShopStatus, ShopType } from '@naqdpos/core';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** Set by the server_seq trigger; whatever a client sends is overwritten. */
type ServerSeq = ColumnType<string, never, never>;

export interface ShopsTable {
  id: string;
  name: string;
  type: ShopType;
  address: string | null;
  phone: string | null;
  receipt_footer: string | null;
  logo_path: string | null;
  status: Generated<ShopStatus>;
  plan_id: string | null;
  timezone: Generated<string>;
  cashier_expense_limit_paisa: Generated<string>;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Date | null;
  device_id: string | null;
  server_seq: ServerSeq;
}

export interface MembershipsTable {
  shop_id: string;
  user_id: string;
  role: Role;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Date | null;
  server_seq: ServerSeq;
}

export interface StaffTable {
  id: string;
  shop_id: string;
  name: string;
  phone: string | null;
  role: Role;
  pin_hash: string | null;
  membership_user_id: string | null;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Date | null;
  device_id: string | null;
  server_seq: ServerSeq;
}

export interface Database {
  shops: ShopsTable;
  memberships: MembershipsTable;
  staff: StaffTable;
}
