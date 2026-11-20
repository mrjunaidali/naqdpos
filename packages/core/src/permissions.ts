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
  /** Edit shop settings (RLS shops_update_owner, column grants; write_roles). */
  manage_shop_settings: ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as Action[];

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return (ACTIONS[action] as readonly Role[]).includes(role);
}
