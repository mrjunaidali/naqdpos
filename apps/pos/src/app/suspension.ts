// A suspended shop (US011): the shop row (pulled) says status 'suspended'. Viewing and sync keep
// working; new sales, khata, expenses and stock movements are blocked here, and the server refuses
// such rows created after suspended_at ('shop_suspended'). Closing the day stays allowed.
import { useLiveQuery } from 'dexie-react-hooks';
import { db as defaultDb, type NaqdDb } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';

export async function isShopSuspended(database: NaqdDb = defaultDb): Promise<boolean> {
  const device = await getStoredDevice();
  if (!device) return false;
  return (await database.shops.get(device.shop_id))?.status === 'suspended';
}

export function useShopSuspended(): boolean {
  return useLiveQuery(() => isShopSuspended(), []) ?? false;
}
