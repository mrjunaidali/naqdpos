// Persistent storage (US001, architecture §6): ask the browser not to clear our IndexedDB under
// storage pressure. Asked on first run and on each start until granted; the answer is kept in
// meta.storage_persisted. The usage estimate (every 30 min) is read by useSyncStatus.
import { db as defaultDb, type NaqdDb } from '../db/schema.ts';

export const STORAGE_PERSISTED_KEY = 'storage_persisted';
export const STORAGE_NOTICE_KEY = 'storage_notice_shown';

export async function ensurePersistentStorage(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator.storage,
  database: NaqdDb = defaultDb,
): Promise<boolean | null> {
  if ((await database.meta.get(STORAGE_PERSISTED_KEY))?.value === true) return true;
  if (!storage?.persist) return null;
  let granted: boolean;
  try {
    granted = (await storage.persisted?.()) || (await storage.persist());
  } catch {
    granted = false;
  }
  await database.meta.put({ key: STORAGE_PERSISTED_KEY, value: granted });
  return granted;
}
