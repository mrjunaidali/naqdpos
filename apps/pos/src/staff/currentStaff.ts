// Who is working on this device right now (US016). UI state in Zustand, persisted to Dexie meta so
// a reload keeps the current staff member; outbox entries and ledger rows read it from meta.
import type { StaffRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { create } from 'zustand';
import { db as defaultDb, type NaqdDb } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';

export const CURRENT_STAFF_KEY = 'current_staff';

interface StoredCurrentStaff {
  staff_id: string;
  switched_at: string;
}

/** The current staff id from meta; falls back to the staff row saved at setup (older devices). */
export async function readCurrentStaffId(database: NaqdDb = defaultDb): Promise<string | null> {
  const stored = (await database.meta.get(CURRENT_STAFF_KEY))?.value as
    StoredCurrentStaff | undefined;
  if (stored) return stored.staff_id;
  if (database !== defaultDb) return null;
  return (await getStoredDevice())?.staff_id ?? null;
}

export async function writeCurrentStaffId(staffId: string, database: NaqdDb = defaultDb) {
  const value: StoredCurrentStaff = { staff_id: staffId, switched_at: new Date().toISOString() };
  await database.meta.put({ key: CURRENT_STAFF_KEY, value });
}

interface CurrentStaffState {
  staffId: string | null;
  /** True once loaded from meta. */
  ready: boolean;
  hydrate: () => Promise<void>;
  switchTo: (staffId: string) => Promise<void>;
}

export const useCurrentStaffStore = create<CurrentStaffState>((set) => ({
  staffId: null,
  ready: false,
  hydrate: async () => set({ staffId: await readCurrentStaffId(), ready: true }),
  switchTo: async (staffId) => {
    await writeCurrentStaffId(staffId);
    set({ staffId, ready: true });
  },
}));

export interface CurrentStaff {
  staff: StaffRow;
  /** False when the stored staff member was deactivated or deleted (locally or by a pull). */
  valid: boolean;
}

/**
 * The current staff row, live from Dexie. undefined while loading; null when nobody is set.
 * A deactivated current staff member comes back with valid = false, and the app asks someone
 * to switch in.
 */
export function useCurrentStaff(): CurrentStaff | null | undefined {
  const { staffId, ready, hydrate } = useCurrentStaffStore();
  useEffect(() => {
    if (!ready) void hydrate();
  }, [ready, hydrate]);
  return useLiveQuery(async () => {
    if (!ready) return undefined;
    if (!staffId) return null;
    const staff = await defaultDb.staff.get(staffId);
    if (!staff) return null;
    return { staff, valid: staff.active && staff.deleted_at === null };
  }, [staffId, ready]);
}
