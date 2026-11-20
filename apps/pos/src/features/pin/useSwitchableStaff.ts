import { canSwitchIn, type StaffRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { readPinLock } from './pinAttempt.ts';

/** Staff of this device's shop who may switch in (active, with a PIN), optionally by role. */
export function useSwitchableStaff(roles?: readonly string[]): StaffRow[] | undefined {
  const key = roles?.join(',') ?? '';
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    const [staff, pins] = await Promise.all([
      db.staff.where('shop_id').equals(device.shop_id).toArray(),
      db.staff_pins.where('shop_id').equals(device.shop_id).toArray(),
    ]);
    const withPin = new Set(pins.filter((p) => p.deleted_at === null).map((p) => p.staff_id));
    return staff
      .filter((s) => canSwitchIn(s, withPin.has(s.id)))
      .filter((s) => !roles || roles.includes(s.role))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [key]);
}

/** Lock state, live from Dexie meta (survives reloads). */
export function usePinLock() {
  return useLiveQuery(() => readPinLock());
}
