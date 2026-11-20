// Staff management rules (US017). Pure, so the form and tests share them.
import { normalizePkMobile } from './phone.ts';
import { isValidPin } from './pin.ts';
import { ROLES, type Role, type StaffRow } from './tenancy.ts';

export interface StaffFormInput {
  name: string;
  /** Optional; a Pakistani mobile when given. */
  phone: string;
  role: string;
  pin: string;
  pinConfirm: string;
}

export type StaffFormError =
  'required' | 'too_long' | 'invalid_mobile' | 'invalid_role' | 'invalid_pin' | 'pin_mismatch';

export interface StaffFormResult {
  errors: Partial<Record<'name' | 'phone' | 'role' | 'pin' | 'pinConfirm', StaffFormError>>;
  /** Normalised values when there are no errors. */
  value?: { name: string; phone: string | null; role: Role; pin: string | null };
}

/**
 * Checks the staff form. A new staff member needs a PIN; when editing, a blank PIN keeps the
 * current one.
 */
export function validateStaffForm(input: StaffFormInput, isNew: boolean): StaffFormResult {
  const errors: StaffFormResult['errors'] = {};
  const name = input.name.trim();
  if (!name) errors.name = 'required';
  else if (name.length > 100) errors.name = 'too_long';

  let phone: string | null = null;
  if (input.phone.trim()) {
    phone = normalizePkMobile(input.phone);
    if (!phone) errors.phone = 'invalid_mobile';
  }

  const role = (ROLES as readonly string[]).includes(input.role) ? (input.role as Role) : null;
  if (!role) errors.role = 'invalid_role';

  const wantsPin = isNew || input.pin !== '' || input.pinConfirm !== '';
  if (wantsPin) {
    if (!isValidPin(input.pin)) errors.pin = isNew && input.pin === '' ? 'required' : 'invalid_pin';
    else if (input.pin !== input.pinConfirm) errors.pinConfirm = 'pin_mismatch';
  }

  if (Object.keys(errors).length > 0 || !role) return { errors };
  return { errors, value: { name, phone, role, pin: wantsPin ? input.pin : null } };
}

type StaffLike = Pick<StaffRow, 'id' | 'role' | 'active' | 'deleted_at'>;

const isActiveOwner = (s: StaffLike) => s.role === 'owner' && s.active && s.deleted_at === null;

/**
 * False when the change would leave the shop with no active owner (deactivating or demoting the
 * last one).
 */
export function keepsAnActiveOwner(
  staff: readonly StaffLike[],
  change: { id: string; role: Role; active: boolean },
): boolean {
  const after = staff.map((s) => (s.id === change.id ? { ...s, ...change } : s));
  if (!staff.some((s) => s.id === change.id)) {
    after.push({ deleted_at: null, ...change });
  }
  return after.some(isActiveOwner);
}

/** Staff who may switch in on a device: active, not deleted, with a PIN set. */
export function canSwitchIn(staff: Pick<StaffRow, 'active' | 'deleted_at'>, hasPin: boolean) {
  return staff.active && staff.deleted_at === null && hasPin;
}
