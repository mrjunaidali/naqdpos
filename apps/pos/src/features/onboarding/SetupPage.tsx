import type { MeResponse } from '@naqdpos/core';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../../api/index.ts';
import { clearSession } from '../../db/session.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { errorMessageKey } from '../../ui/errors.ts';
import { OnboardingForm } from './OnboardingForm.tsx';
import { RegisterDeviceForm } from './RegisterDeviceForm.tsx';
import { ownerShops } from './setup.ts';

type Load =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'done'; me: MeResponse };

/**
 * Signed in, but this device is not set up. Ask the server which shops the user has, so an
 * owner on a second device registers it instead of creating a second shop.
 */
export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [chosen, setChosen] = useState<string>();

  // State changes only in the promise callbacks, so the effect never renders twice in a row.
  const fetchMe = useCallback(
    () =>
      api.me().then(
        (me) => setLoad({ status: 'done', me }),
        (e: unknown) => setLoad({ status: 'failed', message: t(errorMessageKey(e)) }),
      ),
    [t],
  );

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const retry = () => {
    setLoad({ status: 'loading' });
    void fetchMe();
  };

  const done = () => void navigate('/', { replace: true });

  if (load.status === 'loading') return <p role="status">{t('common.loading')}</p>;

  if (load.status === 'failed') {
    return (
      <section className="mx-auto max-w-sm space-y-4">
        <Alert>{load.message}</Alert>
        <Button onClick={retry}>{t('common.retry')}</Button>
      </section>
    );
  }

  const ownedShops = ownerShops(load.me);
  const owned =
    ownedShops.length === 1 ? ownedShops[0] : ownedShops.find((e) => e.shop.id === chosen);
  return (
    <section className="mx-auto max-w-sm">
      {ownedShops.length > 1 && !owned ? (
        // An owner of several shops: each device belongs to one shop.
        <div className="space-y-3">
          <h1 className="text-2xl font-bold">{t('setup.whichShop')}</h1>
          {ownedShops.map((e) => (
            <Button key={e.shop.id} variant="secondary" onClick={() => setChosen(e.shop.id)}>
              {e.shop.name}
            </Button>
          ))}
        </div>
      ) : owned ? (
        <RegisterDeviceForm
          shop={owned.shop}
          ownerStaffId={owned.has_pin === false ? (owned.staff?.id ?? null) : null}
          onDone={done}
        />
      ) : load.me.shops.length > 0 ? (
        // A cashier or rider membership: only the owner can set up a device (§4, §5).
        <div className="space-y-4">
          <Alert>{t('setup.notOwner')}</Alert>
          <Button variant="secondary" onClick={() => void clearSession()}>
            {t('setup.signOut')}
          </Button>
        </div>
      ) : (
        <OnboardingForm onDone={done} />
      )}
    </section>
  );
}
