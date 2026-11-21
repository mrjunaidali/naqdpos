// Synced tables, client side (architecture §4). The server's registry is the `sync_tables` table
// (db/migrations/20261120150000_sync.sql); a new synced table gets one row there and one entry
// here. The API validates pushed rows with `schema`; the app stores pulled rows by `key`.
import type { z } from 'zod';
import {
  CategoryRowSchema,
  PaymentMethodRowSchema,
  PaymentRowSchema,
  StockMovementRowSchema,
  CustomerRowSchema,
  KhataEntryRowSchema,
  ExpenseCategoryRowSchema,
  ExpenseRowSchema,
  DayCloseRowSchema,
  SaleLineRowSchema,
  SaleRowSchema,
  DeviceRowSchema,
  PriceHistoryRowSchema,
  ProductCostHistoryRowSchema,
  ProductCostRowSchema,
  ProductRowSchema,
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
  categories: {
    kind: 'mutable',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: CategoryRowSchema,
  },
  products: { kind: 'mutable', key: 'id', pushable: true, scope: 'all', schema: ProductRowSchema },
  product_costs: {
    kind: 'mutable',
    key: 'product_id',
    pushable: true,
    scope: 'owner_device',
    schema: ProductCostRowSchema,
  },
  price_history: {
    kind: 'append',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: PriceHistoryRowSchema,
  },
  product_cost_history: {
    kind: 'append',
    key: 'id',
    pushable: true,
    scope: 'owner_device',
    schema: ProductCostHistoryRowSchema,
  },
  payment_methods: {
    kind: 'mutable',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: PaymentMethodRowSchema,
  },
  // Ledgers (append-only). Pushed in creation order: a sale before its lines and payments.
  sales: { kind: 'append', key: 'id', pushable: true, scope: 'all', schema: SaleRowSchema },
  sale_lines: {
    kind: 'append',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: SaleLineRowSchema,
  },
  payments: { kind: 'append', key: 'id', pushable: true, scope: 'all', schema: PaymentRowSchema },
  // Stock (US024, US025): pushed after the sale it refers to (creation order).
  stock_movements: {
    kind: 'append',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: StockMovementRowSchema,
  },
  // Customers and khata (US038–US041): customers merge by their UUIDv5 id (last write wins).
  customers: {
    kind: 'mutable',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: CustomerRowSchema,
  },
  khata_entries: {
    kind: 'append',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: KhataEntryRowSchema,
  },
  // Expenses (US065, US046, US066). Shop devices pulling only open dates comes with day_closes.
  expense_categories: {
    kind: 'mutable',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: ExpenseCategoryRowSchema,
  },
  expenses: { kind: 'append', key: 'id', pushable: true, scope: 'all', schema: ExpenseRowSchema },
  // Daily closing (US044): append-only, owners write.
  day_closes: {
    kind: 'append',
    key: 'id',
    pushable: true,
    scope: 'all',
    schema: DayCloseRowSchema,
  },
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
