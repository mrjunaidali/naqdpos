import type { AdminShopDetail } from '@naqdpos/core';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../api/index.ts';
import { useAdmin, when } from './adminContext.ts';
import { Alert, Button, Card } from './ui.tsx';

/** One shop: profile, devices, staff (no PIN data), conflicts, audit; suspend / reactivate. */
export function ShopDetailPage() {
  const { id } = useParams();
  const { expired } = useAdmin();
  const [data, setData] = useState<AdminShopDetail | null>(null);
  const [error, setError] = useState<string>();
  const [changing, setChanging] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    void api
      .adminGetShop(id)
      .then(setData)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) expired();
        else
          setError(
            e instanceof ApiError && e.status === 404
              ? 'Shop not found.'
              : 'Could not load the shop.',
          );
      });
  }, [id, expired]);
  useEffect(load, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const { shop } = data;
  const suspended = shop.status === 'suspended';

  async function change() {
    if (!reason.trim()) return setError('A reason is required.');
    setBusy(true);
    try {
      await api.adminSetShopStatus(shop.id, {
        status: suspended ? 'active' : 'suspended',
        reason: reason.trim(),
      });
      setChanging(false);
      setReason('');
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) expired();
      else setError('Could not change the status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/" className="underline">
        ← Shops
      </Link>
      <h1 className="text-2xl font-bold">{shop.name}</h1>
      <Card title="Profile">
        <dl className="grid grid-cols-2 gap-1 text-sm">
          {(
            [
              ['Status', suspended ? `suspended since ${when(shop.suspended_at)}` : shop.status],
              ['Type', shop.type],
              ['City', shop.city ?? '—'],
              ['Address', shop.address ?? '—'],
              ['Phone', shop.phone ?? '—'],
              ['Owner email', shop.owner_email ?? '—'],
              ['Created', when(shop.created_at)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className={k === 'Status' && suspended ? 'font-semibold text-danger' : ''}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {!changing ? (
          <Button variant={suspended ? 'primary' : 'danger'} onClick={() => setChanging(true)}>
            {suspended ? 'Reactivate shop' : 'Suspend shop'}
          </Button>
        ) : (
          <div className="space-y-2 rounded-xl border border-warning bg-warning-soft p-3 text-warning-fg">
            <label className="block font-medium" htmlFor="reason">
              Reason (required, saved in the audit log)
            </label>
            <textarea
              id="reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-border bg-surface p-2 text-text"
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setChanging(false)}>
                Cancel
              </Button>
              <Button
                variant={suspended ? 'primary' : 'danger'}
                disabled={busy || !reason.trim()}
                onClick={() => void change()}
              >
                {suspended ? 'Yes, reactivate' : 'Yes, suspend'}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card title={`Devices (${data.devices.length})`}>
        <ul className="divide-y divide-border text-sm">
          {data.devices.map((d) => (
            <li key={d.id} className="flex flex-wrap gap-3 py-2">
              <span className="font-mono">{d.code}</span>
              <span className="flex-1">{d.name}</span>
              <span>{d.mode}</span>
              <span className="text-muted">last sync {when(d.last_sync_at)}</span>
              {d.retired && <span className="text-muted">retired</span>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Staff (${data.staff.length})`}>
        <ul className="divide-y divide-border text-sm">
          {data.staff.map((s) => (
            <li key={s.id} className="flex gap-3 py-2">
              <span className="flex-1">{s.name}</span>
              <span>{s.role}</span>
              {!s.active && <span className="text-muted">inactive</span>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Sync conflicts (${data.conflicts.length})`}>
        {data.conflicts.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {data.conflicts.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-3 py-2">
                <span>{c.table_name}</span>
                <span className="font-mono text-muted">{c.row_id}</span>
                <span className="text-muted">{when(c.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Audit log">
        <ul className="divide-y divide-border text-sm">
          {data.audit.map((a) => (
            <li key={a.id} className="space-y-1 py-2">
              <p>
                <span className="font-semibold">{a.action}</span> · {when(a.at)} ·{' '}
                {a.actor_email ?? 'system'}
                {a.acting_as_admin && (
                  <span className="ms-2 rounded-full bg-bg px-2 text-xs">admin</span>
                )}
              </p>
              {a.payload != null && (
                <pre className="overflow-x-auto text-xs text-muted">
                  {JSON.stringify(a.payload)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
