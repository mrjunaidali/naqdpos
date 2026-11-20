// The app's one sync engine, wired to the real API client, Dexie and the window. Started once
// from main.tsx; screens only call syncNow() and read state from Dexie.
import { api } from '../api/index.ts';
import { checkForUpdate } from '../app/swUpdate.ts';
import { APP_VERSION } from '../app/version.ts';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';
import { createSyncEngine } from './engine.ts';

export const syncEngine = createSyncEngine({
  api,
  db,
  appVersion: APP_VERSION,
  getDeviceId: async () => (await getStoredDevice())?.id ?? null,
  isOnline: () => navigator.onLine,
  onUpdateRequired: () => void checkForUpdate(),
  events: window,
});
