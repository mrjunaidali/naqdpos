// Role checks (CLAUDE.md rule 7, US018). The UI hides what a role can't use; the server enforces
// the same rules in API routes, RLS and sync_push (write_roles), so these only drive the UI and
// the API's route checks. Each action names where the server enforces it.
import type { Role } from './tenancy.ts';

export const ACTIONS = {
  /** Add, edit, deactivate staff and set PINs (RLS staff_*_owner, staff_pins_*_owner; write_roles). */
  manage_staff: ['owner'],
  /** Register, rename or retire devices (register_device, devices_*_owner, POST /devices). */
  manage_devices: ['owner'],
  /** See or set salaries (RLS staff_salaries_*_owner; owner_device scope). */
  see_salaries: ['owner'],
  /** See cost prices (product_costs, owner-only with the products story). */
  see_cost_prices: ['owner'],
  /** Totals, profit and reports beyond the own shift (/reports/*, owner-only). */
  see_reports: ['owner'],
  /**
   * Products, categories, sale prices, today's rates, presets (RLS *_owner on the catalogue;
   * write_roles). Cashiers entering a rate at first sale is decided with US029.
   */
  manage_products: ['owner'],
  /** Enable, disable, add and reorder payment methods (RLS payment_methods_*_owner; write_roles). */
  manage_payment_methods: ['owner'],
  /** Record wastage / damaged stock (RLS stock_movements_insert_seller; write_roles). */
  record_wastage: ['owner', 'cashier'],
  /** Stock in and set stock (count): owner only (stock_movements_check() on the actor). */
  adjust_stock: ['owner'],
  /** Set the cashier's discount limit (shops column grant + write_roles {owner}). */
  manage_discount_limit: ['owner'],
  /** Customers, khata on a sale, receive khata payments (RLS *_seller; write_roles). */
  use_khata: ['owner', 'cashier'],
  /** Khata adjustments (khata_entries_check() on the actor). */
  adjust_khata: ['owner'],
  /** Add an expense (RLS expenses_insert_seller; write_roles). Riders: Release 2. */
  add_expense: ['owner', 'cashier'],
  /** Expense categories, reversals and the cashier expense limit (expenses_check() on the actor). */
  manage_expenses: ['owner'],
  /** Close a day and see daily summaries (day_closes_check() on the actor; RLS insert owner). */
  close_day: ['owner'],
  /** Edit shop settings (RLS shops_update_owner, column grants; write_roles). */
  manage_shop_settings: ['owner'],
  /**
   * "Try again" on rejected sync entries (Sync screen). The retried entry is pushed like any
   * other, so sync_push's write_roles, RLS and constraints still decide it on the server.
   */
  retry_sync: ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as Action[];

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return (ACTIONS[action] as readonly Role[]).includes(role);
}
