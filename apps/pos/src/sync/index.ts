// The app's one sync engine, wired to the real API client, Dexie and the window. Started once
// from main.tsx; screens only call syncNow() and read state from Dexie.
import { api } from '../api/index.ts';
import { checkForUpdate } from '../app/swUpdate.ts';
import { APP_VERSION } from '../app/version.ts';
import { db } from '../db/schema.ts';
import { getStoredDevice } from '../db/session.ts';
import { i18n } from '../i18n/index.ts';
import { showToast } from '../ui/toastStore.ts';
import { createSyncEngine } from './engine.ts';

export const syncEngine = createSyncEngine({
  api,
  db,
  appVersion: APP_VERSION,
  getDeviceId: async () => (await getStoredDevice())?.id ?? null,
  isOnline: () => navigator.onLine,
  onUpdateRequired: () => void checkForUpdate(),
  // "Synced 37 records" once a push gets through after being offline (architecture §7).
  onSynced: (pushed, recovered) => {
    if (pushed > 0 && recovered) showToast(i18n.t('sync.syncedRecords', { count: pushed }));
  },
  events: window,
});
