// Sync screen (architecture §7): what is waiting, why sync is unhappy, "Sync now", and the
// entries the server rejected. Everything here is read from Dexie.
import { SYNC_ERROR_CODES, isSyncTable } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { syncEngine } from '../../sync/index.ts';
import { chipTone } from '../../sync/tone.ts';
import { useSyncStatus } from '../../sync/useSyncStatus.ts';

const LEVEL_BOX = {
  success: 'border-success bg-success-soft text-success-fg',
  warning: 'border-warning bg-warning-soft text-warning-fg',
  danger: 'border-danger bg-danger-soft text-danger-fg',
} as const;

const knownCode = (code: string): code is (typeof SYNC_ERROR_CODES)[number] =>
  (SYNC_ERROR_CODES as readonly string[]).includes(code);

export function SyncPage() {
  const { t, i18n } = useTranslation();
  const { health, outboxCount, state, isOnline } = useSyncStatus();
  const errors = useLiveQuery(() => db.sync_errors.orderBy('id').toArray()) ?? [];
  const [busy, setBusy] = useState(false);

  async function syncNow() {
    setBusy(true);
    try {
      await syncEngine.syncNow();
    } finally {
      setBusy(false);
    }
  }

  const tone = chipTone(health.level);
  const lastSync = state.lastSyncAt
    ? t('sync.lastSync', {
        time: new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(state.lastSyncAt)),
      })
    : t('sync.neverSynced');

  const errorText = (code: string) =>
    code === 'clock_ahead'
      ? t('sync.clockAhead')
      : knownCode(code)
        ? t(`sync.error.${code}`)
        : t('sync.error.generic');

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('sync.title')}</h1>

      <div
        role="status"
        data-level={health.level}
        className={`space-y-1 rounded-2xl border p-4 ${LEVEL_BOX[tone]}`}
      >
        <p className="font-semibold">
          {outboxCount > 0 ? t('sync.waiting', { count: outboxCount }) : t('sync.allSynced')}
        </p>
        {health.reasons
          .filter((reason) => reason !== 'pending')
          .map((reason) => (
            <p key={reason}>{t(`sync.reason.${reason}`)}</p>
          ))}
      </div>

      <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <p className="text-muted">{lastSync}</p>
        {!isOnline && <p className="text-muted">{t('sync.offline')}</p>}
        <button
          type="button"
          disabled={busy || !isOnline}
          onClick={() => void syncNow()}
          className="min-h-12 w-full rounded-md bg-primary px-4 font-semibold text-primary-fg disabled:opacity-50"
        >
          {busy ? t('sync.syncing') : t('sync.syncNow')}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-danger bg-surface p-4">
          <h2 className="text-lg font-semibold text-danger-fg">{t('sync.rejectedTitle')}</h2>
          <p className="text-muted">{t('sync.rejectedIntro')}</p>
          <ul className="divide-y divide-border">
            {errors.map((error) => (
              <li key={error.id} className="py-2">
                <p className="font-medium">
                  {isSyncTable(error.table) ? t(`sync.table.${error.table}`) : error.table}
                </p>
                <p className="text-danger-fg">{errorText(error.code)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
