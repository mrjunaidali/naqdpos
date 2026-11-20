// Ledger rows record who made them (architecture §3: "Every sale/expense records staff_id") and on
// which device. Repositories for sales, payments, expenses, … call stampActor() on each new row
// before localWrite, so no screen has to remember it (US016).
import { readCurrentStaffId } from '../staff/currentStaff.ts';
import { getStoredDevice } from './session.ts';
import { db as defaultDb, type NaqdDb } from './schema.ts';

export class NoCurrentStaffError extends Error {
  constructor() {
    super('Nobody is switched in on this device');
    this.name = 'NoCurrentStaffError';
  }
}

/** Adds staff_id (the current staff member) and device_id to a new ledger row. */
export async function stampActor<T extends Record<string, unknown>>(
  row: T,
  database: NaqdDb = defaultDb,
): Promise<T & { staff_id: string; device_id: string | null }> {
  const staffId = await readCurrentStaffId(database);
  if (!staffId) throw new NoCurrentStaffError();
  const deviceId = (await getStoredDevice())?.id ?? null;
  return { ...row, staff_id: staffId, device_id: deviceId };
}
