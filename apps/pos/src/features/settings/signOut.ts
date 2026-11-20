// Sign out on this device (architecture §7 guarded action). Refused while the outbox has entries:
// they would wait for an account that is no longer signed in. The device registration and shop
// data stay; the next sign-in must belong to this shop (completeSignIn).
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { clearSession } from '../../db/session.ts';

export class UnsyncedChangesError extends Error {
  constructor(readonly count: number) {
    super(`${count} changes are not synced yet`);
    this.name = 'UnsyncedChangesError';
  }
}

export async function signOutOnDevice(): Promise<void> {
  const pending = await db.outbox.count();
  if (pending > 0) throw new UnsyncedChangesError(pending);
  try {
    await api.signOut(); // ends the session on the server too, when online
  } catch {
    // Offline or already gone: signing out on the device is what matters.
  }
  await clearSession();
}
