// Finishing a sign-in on this device (architecture §5, §7). A first sign-in just saves the session.
// On a device that is already set up (re-sign-in after the session ended, or after sign-out):
//   - the same user: replace the token, clear "sign in again", sync at once;
//   - another user while changes are waiting: refused (they belong to the previous account);
//   - another user with nothing waiting: allowed only if they are an owner of this device's shop
//     (only owners set devices up, so only an owner may take one over).
// The device registration and shop data always stay.
import { apiWithToken } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice, getStoredSession, saveSession } from '../../db/session.ts';
import { syncEngine } from '../../sync/index.ts';
import { patchSyncState } from '../../sync/state.ts';

export interface SignedIn {
  token: string;
  user: { id: string; email: string };
}

export type SignInOutcome =
  | { status: 'ok' }
  | { status: 'unsynced'; previousEmail: string | null }
  | { status: 'other_shop'; shopName: string }
  | { status: 'not_owner' };

async function accept(result: SignedIn, syncNow: boolean): Promise<SignInOutcome> {
  await saveSession({ token: result.token, user_id: result.user.id, email: result.user.email });
  await patchSyncState(db, { authProblem: null });
  if (syncNow) void syncEngine.syncNow();
  return { status: 'ok' };
}

export async function completeSignIn(result: SignedIn): Promise<SignInOutcome> {
  const [previous, device] = await Promise.all([getStoredSession(), getStoredDevice()]);
  if (!device) {
    await saveSession({ token: result.token, user_id: result.user.id, email: result.user.email });
    return { status: 'ok' };
  }
  if (previous?.user_id === result.user.id) return accept(result, true);

  if ((await db.outbox.count()) > 0) {
    return { status: 'unsynced', previousEmail: previous?.email ?? null };
  }
  // Asked with the new token, before it is stored: is this user an owner of the device's shop?
  const me = await apiWithToken(result.token).me();
  const entry = me.shops.find((s) => s.shop.id === device.shop_id);
  if (!entry) {
    const shop = await db.shops.get(device.shop_id);
    return { status: 'other_shop', shopName: shop?.name ?? '' };
  }
  if (entry.role !== 'owner') return { status: 'not_owner' };
  return accept(result, true);
}
