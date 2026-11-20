// Owner "Forgot PIN?" (architecture §5). Online only: the server emails a code to the signed-in
// owner and checks it. Not an outbox write: the returned staff_pins row (with its server_seq) is
// stored at once, so the new PIN works offline straight away and a later pull does not undo it.
import { hashPin, PIN_LOCK_OPEN, type StaffPinRow, type StaffRow } from '@naqdpos/core';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredSession } from '../../db/session.ts';
import { useCurrentStaffStore, writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { PIN_LOCK_KEY } from './pinAttempt.ts';

/** Only an active owner whose staff row is linked to the signed-in account can reset by email. */
export async function canResetByEmail(staff: StaffRow): Promise<boolean> {
  const session = await getStoredSession();
  return (
    staff.role === 'owner' &&
    staff.active &&
    staff.deleted_at === null &&
    session !== undefined &&
    staff.membership_user_id === session.user_id
  );
}

export async function sendResetCode(staffId: string): Promise<void> {
  await api.sendPinResetCode(staffId);
}

/** Checks the code on the server, then stores the new PIN, clears the lock, switches the owner in. */
export async function resetPinWithCode(staffId: string, code: string, pin: string) {
  const row = await api.resetOwnerPin(staffId, { code, pin_hash: await hashPin(pin) });
  await storeResetPin(row);
  return row;
}

export async function storeResetPin(row: StaffPinRow): Promise<void> {
  await db.transaction('rw', [db.staff_pins, db.meta], async () => {
    await db.staff_pins.put(row);
    await db.meta.put({ key: PIN_LOCK_KEY, value: PIN_LOCK_OPEN });
    await writeCurrentStaffId(row.staff_id);
  });
  useCurrentStaffStore.setState({ staffId: row.staff_id, ready: true });
}
