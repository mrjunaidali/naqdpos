import { Outlet } from 'react-router';
import { OwnerPinGate } from '../pin/OwnerPinGate.tsx';

/** Products, categories, presets and today's rates are owner screens (manage_products). */
export function CatalogueLayout() {
  return (
    <OwnerPinGate>
      <Outlet />
    </OwnerPinGate>
  );
}
