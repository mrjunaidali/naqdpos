// Navigation items by role (US002, design-theme.md): the floating bar on phones, the side nav from
// 768px. Items a role cannot use are not shown.
import { can, type Role } from '@naqdpos/core';

export interface NavItem {
  key: string;
  to: string;
}

/** The bar: Home, Sales, the Sale pill (centre), Products (owner) or Khata (cashier), More. */
export function barItems(role: Role | null): { left: NavItem[]; right: NavItem[] } {
  const left: NavItem[] = [{ key: 'home', to: '/' }];
  if (role === 'owner' || role === 'cashier') left.push({ key: 'sales', to: '/sales' });
  const right: NavItem[] = [];
  if (can(role, 'manage_products')) right.push({ key: 'products', to: '/products' });
  else if (can(role, 'use_khata')) right.push({ key: 'khata', to: '/khata' });
  return { left, right };
}

/** The More sheet (and the rest of the side nav). */
export function moreItems(role: Role | null): NavItem[] {
  const items: NavItem[] = [];
  if (can(role, 'use_khata')) items.push({ key: 'khata', to: '/khata' });
  if (can(role, 'record_wastage')) items.push({ key: 'stock', to: '/stock' });
  if (can(role, 'add_expense')) items.push({ key: 'expenses', to: '/expenses' });
  if (can(role, 'close_day')) items.push({ key: 'closeDay', to: '/closing' });
  if (can(role, 'manage_staff')) items.push({ key: 'staff', to: '/staff' });
  items.push({ key: 'sync', to: '/sync' }, { key: 'settings', to: '/settings' });
  return items;
}

/**
 * No nav in the sale flow (sale, pay, done: the cart bar and the done screen's own buttons sit
 * there) and before the app is ready.
 */
export function navHidden(pathname: string): boolean {
  return (
    pathname === '/sale' ||
    pathname.startsWith('/sale/') ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/setup') ||
    pathname.startsWith('/auth/')
  );
}
