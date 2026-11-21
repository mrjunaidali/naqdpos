import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { useWide } from '../../app/useWide.ts';
import { barItems, moreItems, navHidden, type NavItem } from './navItems.ts';

const barLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-12 min-w-12 flex-col items-center justify-center rounded-xl px-2 text-xs font-medium ${
    isActive ? 'text-hero-fg' : 'text-hero-muted'
  }`;
const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center rounded-md px-3 font-medium ${
    isActive ? 'bg-primary text-primary-fg' : 'text-text hover:bg-bg'
  }`;

/**
 * Phones: a floating near-black bar (Home, Sales, the white Sale pill, Products or Khata, More).
 * From 768px: a side nav with every item. Logical order, so Urdu mirrors it. Hidden on the sale
 * and pay screens (the cart bar is there).
 */
export function Nav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const current = useCurrentStaff();
  const [more, setMore] = useState(false);
  const wide = useWide();
  if (navHidden(pathname) || !current?.valid) return null;
  const role = current.staff.role;
  const { left, right } = barItems(role);
  const rest = moreItems(role);
  const label = (item: NavItem) => t(`nav.${item.key}`);
  const sideItems = [...left, ...right, ...rest.filter((r) => !right.some((x) => x.key === r.key))];

  return (
    <>
      {!wide && (
        <nav aria-label={t('nav.main')} className="fixed inset-x-3 bottom-3 z-20">
          <div className="mx-auto flex max-w-md items-center justify-between rounded-2xl bg-hero px-2 py-1 text-hero-fg shadow-lg">
            {left.map((item) => (
              <NavLink key={item.key} to={item.to} end className={barLink}>
                {label(item)}
              </NavLink>
            ))}
            <NavLink
              to="/sale"
              aria-label={t('home.newSale')}
              className="flex min-h-12 items-center rounded-full bg-surface px-5 text-base font-bold text-text"
            >
              {t('nav.sale')}
            </NavLink>
            {right.map((item) => (
              <NavLink key={item.key} to={item.to} className={barLink}>
                {label(item)}
              </NavLink>
            ))}
            <button
              type="button"
              className={barLink({ isActive: more })}
              onClick={() => setMore(true)}
            >
              {t('nav.more')}
            </button>
          </div>
        </nav>
      )}

      {wide && (
        <nav
          aria-label={t('nav.side')}
          className="w-56 shrink-0 space-y-1 border-e border-border bg-surface p-3"
        >
          <NavLink
            to="/sale"
            className="mb-2 flex min-h-12 items-center justify-center rounded-xl bg-primary font-bold text-primary-fg"
          >
            {t('home.newSale')}
          </NavLink>
          {sideItems.map((item) => (
            <NavLink key={item.key} to={item.to} end={item.to === '/'} className={sideLink}>
              {label(item)}
            </NavLink>
          ))}
        </nav>
      )}

      {more && (
        <Sheet title={t('nav.more')} onClose={() => setMore(false)}>
          <ul className="grid grid-cols-2 gap-2">
            {rest.map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  onClick={() => setMore(false)}
                  className="flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface font-medium text-text"
                >
                  {label(item)}
                </NavLink>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}
