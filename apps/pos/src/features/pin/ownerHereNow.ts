import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { readCurrentStaffId } from '../../staff/currentStaff.ts';

/** Same rule as useOwnerHere, read now: an owner switched in on an owner device, else null. */
export async function ownerHereNow(): Promise<string | null> {
  const device = await getStoredDevice();
  if (device?.mode !== 'owner') return null;
  const id = await readCurrentStaffId();
  const staff = id ? await db.staff.get(id) : undefined;
  return staff?.role === 'owner' && staff.active && staff.deleted_at === null ? staff.id : null;
}
