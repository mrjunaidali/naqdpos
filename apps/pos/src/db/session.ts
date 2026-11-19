// Sign-in and device registration kept on the device (Dexie `meta`, architecture §5): the app
// opens signed in and registered after a restart and offline, without asking the server.
import { db } from './schema.ts';

export interface StoredSession {
  /** Bearer token from Better Auth; sent as Authorization on API calls. */
  token: string;
  user_id: string;
  email: string;
  /** Last time the server confirmed the session (ISO), for the daily background check. */
  checked_at: string;
}

export interface StoredDevice {
  id: string;
  /** Receipt-number prefix assigned by the server (A1, A2, …; architecture §4). */
  code: string;
  shop_id: string;
  /** The signed-in owner's staff row in that shop. */
  staff_id: string | null;
}

const SESSION = 'session';
const DEVICE = 'device';

export async function getStoredSession(): Promise<StoredSession | undefined> {
  return (await db.meta.get(SESSION))?.value as StoredSession | undefined;
}

export async function saveSession(session: Omit<StoredSession, 'checked_at'>): Promise<void> {
  await db.meta.put({ key: SESSION, value: { ...session, checked_at: new Date().toISOString() } });
}

export async function markSessionChecked(): Promise<void> {
  const session = await getStoredSession();
  if (session) await saveSession(session);
}

/** Signs out on this device. Shop data and the device registration stay. */
export async function clearSession(): Promise<void> {
  await db.meta.delete(SESSION);
}

export async function getStoredDevice(): Promise<StoredDevice | undefined> {
  return (await db.meta.get(DEVICE))?.value as StoredDevice | undefined;
}

export const META_KEYS = { SESSION, DEVICE } as const;
