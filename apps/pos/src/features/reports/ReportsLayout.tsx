import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

const TABS = [
  ['', 'dashboard'],
  ['monthly', 'monthly'],
  ['products', 'products'],
  ['staff', 'staff'],
  ['expenses', 'expenses'],
] as const;

/** Owner reports (US047–US049, US068). The route wraps this in OwnerPinGate. */
export function ReportsLayout() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-3xl space-y-4 pb-8">
      <h1 className="text-2xl font-bold">{t('reports.title')}</h1>
      <nav aria-label={t('reports.title')} className="flex flex-wrap gap-2 print:hidden">
        {TABS.map(([path, key]) => (
          <NavLink
            key={key}
            to={path ? `/reports/${path}` : '/reports'}
            end
            className={({ isActive }) =>
              `inline-flex min-h-11 items-center rounded-full border px-4 ${
                isActive ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface'
              }`
            }
          >
            {t(`reports.tab.${key}`)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
