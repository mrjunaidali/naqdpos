import { createContext, useContext } from 'react';

/**
 * The owner acting on an owner screen: the current staff member on an owner device, or the owner
 * who entered their PIN (OwnerPinGate). Writes from that screen carry this staff id as their
 * actor, so sync_push's write_roles check sees the owner (architecture §4, §5).
 */
export const ActingOwnerContext = createContext<string | null>(null);

export function useActingOwnerId(): string {
  const id = useContext(ActingOwnerContext);
  if (!id) throw new Error('useActingOwnerId must be used inside <OwnerPinGate>');
  return id;
}
