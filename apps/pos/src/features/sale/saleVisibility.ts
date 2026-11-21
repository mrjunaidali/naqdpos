import type { SaleRow } from '@naqdpos/core';
import { useCurrentStaff } from '../../staff/currentStaff.ts';

/**
 * Who may see a sale: owners see every sale; cashiers only their own (US018). On a shared shop
 * device the server cannot tell who looks (the owner's session), so this is a UI rule
 * (architecture §5).
 */
export function visibleTo(
  sale: Pick<SaleRow, 'staff_id'>,
  staffId: string | null,
  isOwner: boolean,
) {
  return isOwner || sale.staff_id === staffId;
}

export function useViewer() {
  const current = useCurrentStaff();
  if (!current?.valid) return { staffId: null, isOwner: false, ready: current !== undefined };
  return { staffId: current.staff.id, isOwner: current.staff.role === 'owner', ready: true };
}
