// Checking a staff PIN on the device (US016, architecture §5): offline, against the synced
// staff_pins hash. The lock state lives in Dexie meta, so reloading the app does not reset it.
import {
  canSwitchIn,
  isPinLocked,
  PIN_LOCK_OPEN,
  PIN_MAX_FAILURES,
  recordPinFailure,
  recordPinSuccess,
  verifyPin,
  type PinLockState,
} from '@naqdpos/core';
import { db as defaultDb, type NaqdDb } from '../../db/schema.ts';

export const PIN_LOCK_KEY = 'pin_lock';

export async function readPinLock(database: NaqdDb = defaultDb): Promise<PinLockState> {
  const value = (await database.meta.get(PIN_LOCK_KEY))?.value as PinLockState | undefined;
  return value ?? PIN_LOCK_OPEN;
}

async function writePinLock(state: PinLockState, database: NaqdDb) {
  await database.meta.put({ key: PIN_LOCK_KEY, value: state });
}

export type PinAttemptResult =
  /** Correct PIN. */
  | { status: 'ok' }
  /** Wrong PIN; `left` tries before the lock. */
  | { status: 'wrong'; left: number }
  /** Locked (now or by this attempt) until `until` (ms epoch). */
  | { status: 'locked'; until: number }
  /** Deactivated, deleted, unknown, or no PIN set: cannot switch in. Not counted as a try. */
  | { status: 'not_allowed' };

/** Checks `pin` for `staffId`. `roles` limits who counts (e.g. only owners for an owner screen). */
export async function attemptPin(
  staffId: string,
  pin: string,
  options: { roles?: readonly string[]; now?: () => number; database?: NaqdDb } = {},
): Promise<PinAttemptResult> {
  const database = options.database ?? defaultDb;
  const now = options.now ?? Date.now;
  const lock = await readPinLock(database);
  if (isPinLocked(lock, now())) return { status: 'locked', until: lock.lockedUntil! };

  const [staff, pinRow] = await Promise.all([
    database.staff.get(staffId),
    database.staff_pins.get(staffId),
  ]);
  const hasPin = pinRow !== undefined && pinRow.deleted_at === null;
  if (!staff || !canSwitchIn(staff, hasPin)) return { status: 'not_allowed' };
  if (options.roles && !options.roles.includes(staff.role)) return { status: 'not_allowed' };

  if (await verifyPin(pin, pinRow!.pin_hash)) {
    await writePinLock(recordPinSuccess(), database);
    return { status: 'ok' };
  }
  const next = recordPinFailure(await readPinLock(database), now());
  await writePinLock(next, database);
  if (isPinLocked(next, now())) return { status: 'locked', until: next.lockedUntil! };
  return { status: 'wrong', left: PIN_MAX_FAILURES - next.failures };
}
