import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { syncEngine } from '../../sync/index.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import type { SignInOutcome } from './completeSignIn.ts';

/** Why a sign-in on this device was refused, and Sync now when changes are waiting. */
export function SignInBlocked({ outcome }: { outcome: Exclude<SignInOutcome, { status: 'ok' }> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  if (outcome.status === 'not_owner') return <Alert>{t('signIn.notOwner')}</Alert>;
  if (outcome.status === 'other_shop') {
    return <Alert>{t('signIn.otherShop', { shop: outcome.shopName })}</Alert>;
  }
  return (
    <div className="space-y-3">
      <Alert>
        {outcome.previousEmail
          ? t('signIn.unsyncedOther', { email: outcome.previousEmail })
          : t('signIn.unsyncedOtherUnknown')}
      </Alert>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void syncEngine.syncNow().finally(() => setBusy(false));
        }}
      >
        {busy ? t('sync.syncing') : t('sync.syncNow')}
      </Button>
    </div>
  );
}
