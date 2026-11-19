import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema.ts';
import { getStoredDevice, getStoredSession } from '../db/session.ts';

/**
 * Where the app is, decided from Dexie only (never the network), so it opens offline:
 * - signed-out: no session on this device
 * - setup: signed in, but this device has no registered shop yet (onboarding / register)
 * - ready: signed in and registered; the shop is on the device
 */
export type AppState = 'signed-out' | 'setup' | 'ready';

export async function readAppState(): Promise<AppState> {
  const session = await getStoredSession();
  if (!session) return 'signed-out';
  const device = await getStoredDevice();
  if (!device) return 'setup';
  return (await db.shops.get(device.shop_id)) ? 'ready' : 'setup';
}

/** undefined while Dexie is loading. Updates live when sign-in or setup writes to Dexie. */
export function useAppState(): AppState | undefined {
  return useLiveQuery(readAppState);
}
