// The shop's closed business dates on this device (US044). Every new ledger row uses them through
// businessDateFor(): after closing, rows count for the next open day (selling never blocks).
import { businessDateFor } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db as defaultDb, type NaqdDb } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

export async function shopClosedDates(database: NaqdDb = defaultDb): Promise<Set<string>> {
  const device = await getStoredDevice();
  if (!device) return new Set();
  const closes = await database.day_closes.where('shop_id').equals(device.shop_id).toArray();
  return new Set(closes.map((c) => c.business_date));
}

export function useClosedDates(): Set<string> | undefined {
  return useLiveQuery(() => shopClosedDates());
}

/** The business date new rows get right now. */
export function useCurrentBusinessDate(): string | undefined {
  const closed = useClosedDates();
  return closed ? businessDateFor(new Date(), closed) : undefined;
}
