import type { AdminCatalogue, ShopType } from '@naqdpos/core';
import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { api } from '../api/index.ts';
import { useFailure } from '../app/adminContext.ts';
import { Alert } from '../app/ui.tsx';
import { ActContext } from './actContext.ts';

const TABS = [
  ['', 'Products'],
  ['produce', 'Fresh produce list'],
  ['import', 'CSV import'],
  ['categories', 'Categories'],
  ['staff', 'Staff'],
] as const;

/**
 * US013 "Act as shop": every screen under it shows the banner. Each write goes through an
 * admin SQL function and is audit-logged as the admin (acting_as_admin), never as the owner.
 */
export function ActLayout() {
  const { id = '' } = useParams();
  const fail = useFailure();
  const [shop, setShop] = useState<{ id: string; name: string; type: ShopType }>();
  const [catalogue, setCatalogue] = useState<AdminCatalogue>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setCatalogue(await api.adminCatalogue(id));
    } catch (e) {
      setError(fail(e, 'Could not load the shop.'));
    }
  }, [id, fail]);

  useEffect(() => {
    let alive = true;
    void Promise.all([api.adminGetShop(id), api.adminCatalogue(id)])
      .then(([detail, cat]) => {
        if (!alive) return;
        setShop({ id, name: detail.shop.name, type: detail.shop.type as ShopType });
        setCatalogue(cat);
      })
      .catch((e: unknown) => alive && setError(fail(e, 'Could not load the shop.')));
    return () => {
      alive = false;
    };
  }, [id, fail]);

  if (error) return <Alert>{error}</Alert>;
  if (!shop || !catalogue) return <p className="text-muted">Loading…</p>;
  return (
    <ActContext.Provider value={{ shop, catalogue, reload }}>
      <div className="space-y-4">
        <div
          role="region"
          aria-label="Acting as shop"
          className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning-soft px-4 py-3 text-warning-fg"
        >
          <p className="flex-1 font-semibold">
            Acting as {shop.name}
            <span className="ms-2 font-normal">
              — every change is saved as you (admin) and audit-logged
            </span>
          </p>
          <Link to={`/shops/${id}`} className="underline">
            Stop acting
          </Link>
        </div>
        <nav aria-label="Shop setup" className="flex flex-wrap gap-2">
          {TABS.map(([path, label]) => (
            <NavLink
              key={label}
              to={path}
              end
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center rounded-md border px-3 ${
                  isActive
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'border-border bg-surface'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </ActContext.Provider>
  );
}
