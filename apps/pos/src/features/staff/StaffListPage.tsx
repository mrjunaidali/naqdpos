import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

/** Owner screen (US017): everyone in the shop, active first. */
export function StaffListPage() {
  const { t } = useTranslation();
  const staff = useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    const rows = await db.staff.where('shop_id').equals(device.shop_id).toArray();
    return rows
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  });

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('staff.title')}</h1>
        <Link
          to="/staff/new"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-primary-fg"
        >
          {t('staff.add')}
        </Link>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {staff?.map((s) => (
          <li key={s.id}>
            <Link
              to={`/staff/${s.id}`}
              className="flex min-h-14 items-center justify-between gap-3 px-4 py-2"
            >
              <span>
                <span className="block font-medium">{s.name}</span>
                <span className="block text-sm text-muted">
                  {t(`role.${s.role}`)}
                  {s.phone ? ` · ${s.phone}` : ''}
                </span>
              </span>
              {!s.active && (
                <span className="rounded-full bg-bg px-2 py-1 text-xs text-muted">
                  {t('staff.inactive')}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
