// Client-side role checks (CLAUDE.md rule 7). Each one mirrors an RLS policy in
// db/migrations; the server enforces them too, these only drive the UI.
import type { Role } from './tenancy.ts';

/** Edit shop settings (RLS: shops_update_owner). */
export function canManageShop(role: Role): boolean {
  return role === 'owner';
}

/** Add or edit staff, including PINs (RLS: staff_insert_owner, staff_update_owner). */
export function canManageStaff(role: Role): boolean {
  return role === 'owner';
}

/** See or set staff salaries (RLS: staff_salaries_*_owner). */
export function canSeeSalaries(role: Role): boolean {
  return role === 'owner';
}

/** Register, rename or retire devices (RLS: devices_insert_owner, devices_update_owner). */
export function canManageDevices(role: Role): boolean {
  return role === 'owner';
}
