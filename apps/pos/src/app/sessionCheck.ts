// Daily background check of the stored session (architecture §5: refreshed while online).
// It never blocks the UI and ignores network failures, so selling is never affected (rule 1).
import { useEffect } from 'react';
import { api, ApiError } from '../api/index.ts';
import { clearSession, getStoredSession, markSessionChecked } from '../db/session.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function checkSession(now: number = Date.now()): Promise<void> {
  const session = await getStoredSession();
  if (!session || now - Date.parse(session.checked_at) < DAY_MS) return;
  try {
    // A bearer request also extends the session on the server (Better Auth updateAge).
    const result = await api.getSession();
    if (result) await markSessionChecked();
    else await clearSession(); // revoked or expired on the server: sign in again
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) await clearSession();
    // Offline or server trouble: keep the session and try again next time.
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
