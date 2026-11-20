import { Outlet } from 'react-router';
import { OwnerPinGate } from '../pin/OwnerPinGate.tsx';

/** One owner check per visit to the staff screens (list and form share it). */
export function StaffLayout() {
  return (
    <OwnerPinGate>
      <Outlet />
    </OwnerPinGate>
  );
}
