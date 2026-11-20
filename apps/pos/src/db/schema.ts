import type {
  CategoryRow,
  PaymentMethodRow,
  PaymentRow,
  SaleLineRow,
  SaleRow,
  DeviceRow,
  PriceHistoryRow,
  ProductCostHistoryRow,
  ProductCostRow,
  ProductRow,
  OutboxOp,
  ShopRow,
  StaffPinRow,
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
  /**
   * The staff member acting when the write was made (PIN-switched, or the owner who entered
   * their PIN on an owner screen). sync_push checks it against the table's write_roles.
   */
  actor_staff_id: string | null;
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
  declare staff_pins: EntityTable<StaffPinRow, 'staff_id'>;
  declare categories: EntityTable<CategoryRow, 'id'>;
  declare payment_methods: EntityTable<PaymentMethodRow, 'id'>;
  declare sales: EntityTable<SaleRow, 'id'>;
  declare sale_lines: EntityTable<SaleLineRow, 'id'>;
  declare payments: EntityTable<PaymentRow, 'id'>;
  declare products: EntityTable<ProductRow, 'id'>;
  declare product_costs: EntityTable<ProductCostRow, 'product_id'>;
  declare price_history: EntityTable<PriceHistoryRow, 'id'>;
  declare product_cost_history: EntityTable<ProductCostHistoryRow, 'id'>;
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
    // PIN hashes moved out of staff (migration 20261120170000_staff_pins). Owner and shop devices
    // pull them; rider devices never do.
    this.version(4).stores({
      staff_pins: 'staff_id, shop_id, server_seq',
    });
    // Catalogue (migration 20261121090000_catalogue). product_costs and product_cost_history are
    // owner-only: only owner devices pull them.
    this.version(5).stores({
      categories: 'id, shop_id, server_seq',
      products: 'id, shop_id, category_id, server_seq',
      product_costs: 'product_id, shop_id, server_seq',
      price_history: 'id, product_id, server_seq',
      product_cost_history: 'id, product_id, server_seq',
    });
    // products.icon (migration 20261121180000_product_icon): a new field on products, no index,
    // so no store changes; the bump keeps Dexie in step with the server schema (rule 8).
    this.version(6).stores({});
    // Sales (migration 20261121210000_sales). receipt_no is indexed so the per-device counter can
    // be checked against the sales already on the device.
    this.version(7).stores({
      payment_methods: 'id, shop_id, server_seq',
      sales: 'id, shop_id, business_date, receipt_no, server_seq',
      sale_lines: 'id, sale_id, server_seq',
      payments: 'id, sale_id, business_date, server_seq',
    });
  }
}

export const db = new NaqdDb();
