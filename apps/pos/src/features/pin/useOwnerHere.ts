import { useLiveQuery } from 'dexie-react-hooks';
import { getStoredDevice } from '../../db/session.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';

/**
 * The owner who may act without typing a PIN: an owner switched in on an owner device (the same
 * rule as OwnerPinGate). null = an owner PIN is needed; undefined while loading.
 */
export function useOwnerHere(): string | null | undefined {
  const current = useCurrentStaff();
  const mode = useLiveQuery(async () => (await getStoredDevice())?.mode ?? 'shop');
  if (current === undefined || mode === undefined) return undefined;
  return mode === 'owner' && current?.valid && current.staff.role === 'owner'
    ? current.staff.id
    : null;
}
