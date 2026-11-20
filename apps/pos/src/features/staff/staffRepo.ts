// Saving staff (US017): Dexie + outbox through localWriteMany, so it works offline and syncs.
// The PIN is hashed on the device (core hashPin) and stored in staff_pins; the PIN itself is
// never stored or sent.
import {
  hashPin,
  keepsAnActiveOwner,
  uuidv7,
  type Role,
  type StaffPinRow,
  type StaffRow,
} from '@naqdpos/core';
import { localWriteMany, type LocalWrite } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

export class LastOwnerError extends Error {
  constructor() {
    super('The shop needs at least one active owner');
    this.name = 'LastOwnerError';
  }
}

export interface StaffChange {
  name: string;
  phone: string | null;
  role: Role;
  /** New PIN, or null to keep the current one (editing only). */
  pin: string | null;
  active: boolean;
}

async function shopContext() {
  const device = await getStoredDevice();
  if (!device) throw new Error('This device is not set up');
  return device;
}

/** Adds (existing = null) or edits a staff member. Returns the staff id. */
export async function saveStaff(
  existing: StaffRow | null,
  change: StaffChange,
  actorStaffId: string,
): Promise<string> {
  const device = await shopContext();
  const shopStaff = await db.staff.where('shop_id').equals(device.shop_id).toArray();
  const id = existing?.id ?? uuidv7();
  if (!keepsAnActiveOwner(shopStaff, { id, role: change.role, active: change.active })) {
    throw new LastOwnerError();
  }

  const now = new Date().toISOString();
  const staff: StaffRow = existing
    ? {
        ...existing,
        name: change.name,
        phone: change.phone,
        role: change.role,
        active: change.active,
        updated_at: now,
      }
    : {
        id,
        shop_id: device.shop_id,
        name: change.name,
        phone: change.phone,
        role: change.role,
        pin_hash: null,
        membership_user_id: null,
        active: change.active,
        device_id: device.id,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        server_seq: null,
      };
  const writes: LocalWrite[] = [{ table: 'staff', op: 'upsert', row: { ...staff } }];

  if (change.pin !== null) {
    const pinHash = await hashPin(change.pin);
    const old = await db.staff_pins.get(id);
    const pinRow: StaffPinRow = {
      staff_id: id,
      shop_id: device.shop_id,
      pin_hash: pinHash,
      device_id: device.id,
      created_at: old?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      server_seq: old?.server_seq ?? null,
    };
    writes.push({ table: 'staff_pins', op: 'upsert', row: { ...pinRow } });
  }

  await localWriteMany(writes, db, { actorStaffId });
  return id;
}

/** Deactivate or reactivate; deactivated staff cannot switch in. */
export async function setStaffActive(staff: StaffRow, active: boolean, actorStaffId: string) {
  await saveStaff(
    staff,
    { name: staff.name, phone: staff.phone, role: staff.role, pin: null, active },
    actorStaffId,
  );
}
