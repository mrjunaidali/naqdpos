import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { useWide } from '../../app/useWide.ts';
import { NavIcon } from '../../ui/icons.tsx';
import { barItems, moreItems, navHidden, type NavItem } from './navItems.ts';

const barLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-xs font-medium ${
    isActive ? 'text-hero-fg' : 'text-hero-muted'
  }`;
const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center gap-3 rounded-md px-3 font-medium ${
    isActive ? 'bg-primary text-primary-fg' : 'text-text hover:bg-bg'
  }`;

/** Height of the docked bar above the safe area; matches its h-14. */
const BAR_HEIGHT = '3.5rem';

/**
 * Phones: a near-black bar docked to the bottom edge (Home, Sales, the white Sale pill, Products or Khata, More).
 * From 768px: a side nav with every item. Logical order, so Urdu mirrors it. Hidden on the sale
 * and pay screens (the cart bar is there).
 */
export function Nav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const current = useCurrentStaff();
  const [more, setMore] = useState(false);
  const wide = useWide();
  const hidden = navHidden(pathname) || !current?.valid;
  const bar = !hidden && !wide;
  // Publish the bar height so the main area and action bars keep clear of it (index.css).
  useEffect(() => {
    if (!bar) return;
    const root = document.documentElement.style;
    root.setProperty('--nav-h', BAR_HEIGHT);
    return () => root.setProperty('--nav-h', '0px');
  }, [bar]);
  if (hidden) return null;
  const role = current.staff.role;
  const { left, right } = barItems(role);
  const rest = moreItems(role);
  const label = (item: NavItem) => t(`nav.${item.key}`);
  const sideItems = [...left, ...right, ...rest.filter((r) => !right.some((x) => x.key === r.key))];

  return (
    <>
      {!wide && (
        // Docked full width: the dark background runs down through the home-indicator area while
        // the safe-area padding keeps the buttons above it.
        <nav
          aria-label={t('nav.main')}
          className="fixed inset-x-0 bottom-0 z-20 rounded-t-xl bg-hero pb-[env(safe-area-inset-bottom)] text-hero-fg shadow-lg"
        >
          <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-1 px-2">
            {left.map((item) => (
              <NavLink key={item.key} to={item.to} end className={barLink}>
                <NavIcon name={item.key} />
                {label(item)}
              </NavLink>
            ))}
            {/* Raised above the bar: the one action that matters most. */}
            <NavLink
              to="/sale"
              aria-label={t('home.newSale')}
              className="-mt-6 flex min-h-16 min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border-4 border-hero bg-surface px-3 text-xs font-bold text-text shadow-lg"
            >
              <NavIcon name="sale" />
              {t('nav.sale')}
            </NavLink>
            {right.map((item) => (
              <NavLink key={item.key} to={item.to} className={barLink}>
                <NavIcon name={item.key} />
                {label(item)}
              </NavLink>
            ))}
            <button
              type="button"
              className={barLink({ isActive: more })}
              onClick={() => setMore(true)}
            >
              <NavIcon name="more" />
              {t('nav.more')}
            </button>
          </div>
        </nav>
      )}

      {wide && (
        <nav
          aria-label={t('nav.side')}
          className="sticky top-header h-[calc(100dvh-var(--top-inset))] w-56 shrink-0 space-y-1 overflow-y-auto border-e border-border bg-surface p-3"
        >
          <NavLink
            to="/sale"
            className="mb-2 flex min-h-12 items-center justify-center rounded-xl bg-primary font-bold text-primary-fg"
          >
            <NavIcon name="sale" className="me-2 size-5" />
            {t('home.newSale')}
          </NavLink>
          {sideItems.map((item) => (
            <NavLink key={item.key} to={item.to} end={item.to === '/'} className={sideLink}>
              <NavIcon name={item.key} className="size-5" />
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
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface font-medium text-text"
                >
                  <NavIcon name={item.key} className="size-5" />
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
