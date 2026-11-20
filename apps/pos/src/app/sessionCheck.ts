// Daily background check of the stored session (architecture §5: refreshed while online).
// It never blocks the UI and never signs anyone out (§7: data and the device always stay). When
// the server no longer knows the session, sync is paused with "Sign in again" (auth_required);
// the user signs in again from the Sync screen. Network failures are ignored.
import { useEffect } from 'react';
import { api, ApiError } from '../api/index.ts';
import { db } from '../db/schema.ts';
import { getStoredSession, markSessionChecked } from '../db/session.ts';
import { patchSyncState } from '../sync/state.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function checkSession(now: number = Date.now()): Promise<void> {
  const session = await getStoredSession();
  if (!session || now - Date.parse(session.checked_at) < DAY_MS) return;
  try {
    // A bearer request also extends the session on the server (Better Auth updateAge).
    const result = await api.getSession();
    if (result) await markSessionChecked();
    else await patchSyncState(db, { authProblem: 'auth_required' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await patchSyncState(db, { authProblem: 'auth_required' });
    }
    // Offline or server trouble: keep everything and try again next time.
  }
}

export function useSessionCheck(): void {
  useEffect(() => {
    const run = () => void checkSession();
    run();
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, []);
}
