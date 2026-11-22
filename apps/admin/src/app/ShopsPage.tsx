import { SHOP_TYPES, type AdminShopListResponse } from '@naqdpos/core';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError } from '../api/index.ts';
import { Alert, Button } from './ui.tsx';
import { useAdmin, when } from './adminContext.ts';

/** Shops (US010): search, filters, paging. Plan shows "—" until plans exist. */
export function ShopsPage() {
  const { expired } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<AdminShopListResponse | null>(null);
  const [error, setError] = useState<string>();
  const filters = {
    q: params.get('q') ?? '',
    status: (params.get('status') ?? '') as '' | 'active' | 'suspended',
    type: params.get('type') ?? '',
    city: params.get('city') ?? '',
    page: Number(params.get('page') ?? '1') || 1,
  };
  const [q, setQ] = useState(filters.q);

  useEffect(() => {
    let alive = true;
    void api
      .adminListShops({
        page: filters.page,
        ...(filters.q && { q: filters.q }),
        ...(filters.status && { status: filters.status }),
        ...(filters.type && { type: filters.type as (typeof SHOP_TYPES)[number] }),
        ...(filters.city && { city: filters.city }),
      })
      .then((r) => alive && setData(r))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) expired();
        else setError('Could not load shops.');
      });
    return () => {
      alive = false;
    };
  }, [filters.q, filters.status, filters.type, filters.city, filters.page, expired]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Shops</h1>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', q.trim());
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, phone or owner email"
          aria-label="Search shops"
          className="min-h-11 flex-1 rounded-md border border-border bg-surface px-3"
        />
        <select
          aria-label="Status"
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          className="min-h-11 rounded-md border border-border bg-surface px-2"
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          aria-label="Shop type"
          value={filters.type}
          onChange={(e) => setFilter('type', e.target.value)}
          className="min-h-11 rounded-md border border-border bg-surface px-2"
        >
          <option value="">Any type</option>
          {SHOP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          aria-label="City"
          placeholder="City"
          defaultValue={filters.city}
          onBlur={(e) => setFilter('city', e.target.value.trim())}
          className="min-h-11 w-32 rounded-md border border-border bg-surface px-3"
        />
        <Button type="submit">Search</Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <p className="text-sm text-muted">{data.total} shops</p>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-start text-muted">
                <tr>
                  {[
                    'Name',
                    'Type',
                    'City',
                    'Status',
                    'Plan',
                    'Owner email',
                    'Devices',
                    'Last sync',
                    'Last sale',
                    'Sales 7 days',
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 text-start font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link to={`/shops/${s.id}`} className="font-semibold underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{s.type}</td>
                    <td className="px-3 py-2">{s.city ?? '—'}</td>
                    <td
                      className={`px-3 py-2 ${s.status === 'suspended' ? 'font-semibold text-danger' : ''}`}
                    >
                      {s.status}
                    </td>
                    <td className="px-3 py-2">—</td>
                    <td className="px-3 py-2">{s.owner_email ?? '—'}</td>
                    <td className="px-3 py-2">{s.devices}</td>
                    <td className="px-3 py-2">{when(s.last_sync_at)}</td>
                    <td className="px-3 py-2">{s.last_sale_date ?? '—'}</td>
                    <td className="px-3 py-2">{s.sales_7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={data.page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('page', String(data.page - 1));
                setParams(next);
              }}
            >
              Previous
            </Button>
            <span className="text-sm">
              Page {data.page} of {pages}
            </span>
            <Button
              variant="secondary"
              disabled={data.page >= pages}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('page', String(data.page + 1));
                setParams(next);
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
