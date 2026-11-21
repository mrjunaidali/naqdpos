import { can } from '@naqdpos/core';
import { InstallCard } from '../../app/InstallCard.tsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { otherLanguage } from '../../i18n/index.ts';
import { db } from '../../db/schema.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { syncEngine } from '../../sync/index.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { signOutOnDevice } from './signOut.ts';

const linkClass =
  'flex min-h-12 items-center justify-between rounded-xl border border-border bg-surface px-4 font-medium';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const current = useCurrentStaff();
  const pending = useLiveQuery(() => db.outbox.count());
  const [busy, setBusy] = useState(false);
  const role = current?.valid ? current.staff.role : null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <InstallCard dismissible={false} />
      <nav className="space-y-2">
        {/* Hidden by role (US018); the staff screens also ask for an owner PIN. */}
        {can(role, 'manage_staff') && (
          <Link to="/staff" className={linkClass}>
            {t('staff.title')}
          </Link>
        )}
        {can(role, 'manage_products') && (
          <Link to="/products" className={linkClass}>
            {t('products.title')}
          </Link>
        )}
        {can(role, 'manage_payment_methods') && (
          <Link to="/settings/payment-methods" className={linkClass}>
            {t('paymentMethods.title')}
          </Link>
        )}
        {can(role, 'manage_shop_settings') && (
          <Link to="/settings/shop" className={linkClass}>
            {t('shopProfile.title')}
          </Link>
        )}
        {can(role, 'manage_expenses') && (
          <Link to="/settings/expense-categories" className={linkClass}>
            {t('expenseCategories.title')}
          </Link>
        )}
        {can(role, 'manage_discount_limit') && (
          <Link to="/settings/discount-limit" className={linkClass}>
            {t('discountLimit.title')}
          </Link>
        )}
        {can(role, 'manage_devices') && (
          <Link to="/settings/device" className={linkClass}>
            {t('deviceMode.title')}
          </Link>
        )}
        <Link to="/sync" className={linkClass}>
          {t('sync.title')}
        </Link>
        <button
          type="button"
          className={`${linkClass} w-full`}
          onClick={() => void i18n.changeLanguage(otherLanguage(i18n.language))}
        >
          <span>{t('language.switchLabel')}</span>
          <span>{t('language.other')}</span>
        </button>
      </nav>

      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">{t('settings.signOutTitle')}</h2>
        {pending !== undefined && pending > 0 ? (
          <>
            {/* §7 guarded action: never sign out with unsynced changes on the device. */}
            <Alert>{t('settings.signOutBlocked', { count: pending })}</Alert>
            <Button disabled={busy} onClick={() => void act(() => syncEngine.syncNow())}>
              {busy ? t('sync.syncing') : t('sync.syncNow')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted">{t('settings.signOutIntro')}</p>
            <Button
              variant="secondary"
              disabled={busy || pending === undefined}
              onClick={() => void act(signOutOnDevice)}
            >
              {t('settings.signOut')}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
