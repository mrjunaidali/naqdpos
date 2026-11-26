// Sync screen (architecture §7): what is waiting, why sync is unhappy, "Sync now", and the
// entries the server rejected (owners can send them again). Everything here is read from Dexie.
import { can, isSyncTable, SYNC_ERROR_CODES, syncRecordName, unitServerLacks } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { requeueRejected } from '../../db/outbox.ts';
import { db, type SyncErrorRow } from '../../db/schema.ts';
import { intlLocale } from '../../i18n/format.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { syncEngine } from '../../sync/index.ts';
import { readServerUnits } from '../../sync/state.ts';
import { chipTone, type SyncTone } from '../../sync/tone.ts';
import { useSyncStatus } from '../../sync/useSyncStatus.ts';

const LEVEL_BOX = {
  success: 'border-success bg-success-soft text-success-fg',
  warning: 'border-warning bg-warning-soft text-warning-fg',
  danger: 'border-danger bg-danger-soft text-danger-fg',
} as const;

/** Reasons that stay red even when rejected entries alone would only be a warning. */
const DANGER_REASONS = new Set(['age_24h', 'storage_95']);

const knownCode = (code: string): code is (typeof SYNC_ERROR_CODES)[number] =>
  (SYNC_ERROR_CODES as readonly string[]).includes(code);

/** Outbox entries held back because the server does not list their unit yet. */
function useHeldUnits() {
  return useLiveQuery(async () => {
    const units = await readServerUnits(db);
    const held = new Set<string>();
    let count = 0;
    await db.outbox
      .where('table')
      .anyOf(['products', 'sale_lines'])
      .each((entry) => {
        const unit = unitServerLacks(entry, units);
        if (unit) {
          held.add(unit);
          count += 1;
        }
      });
    return { count, units: [...held].sort() };
  });
}

export function SyncPage() {
  const { t, i18n } = useTranslation();
  const { health, outboxCount, state, isOnline } = useSyncStatus();
  const errors = useLiveQuery(() => db.sync_errors.orderBy('id').toArray()) ?? [];
  const held = useHeldUnits();
  const current = useCurrentStaff();
  const canRetry = can(current?.valid ? current.staff.role : null, 'retry_sync');
  const [busy, setBusy] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);

  async function syncNow() {
    setBusy(true);
    try {
      await syncEngine.syncNow();
    } finally {
      setBusy(false);
    }
  }

  /** Back to the outbox, then sync; offline it waits there until the connection returns. */
  async function retry(ids: string[]) {
    await requeueRejected(ids);
    setQueuedOffline(!isOnline);
    if (isOnline) await syncNow();
  }

  const rejected = errors.length;
  const tone: SyncTone =
    rejected > 0 && !health.reasons.some((r) => DANGER_REASONS.has(r))
      ? 'warning'
      : chipTone(health.level);
  const headline =
    rejected > 0
      ? t('sync.notAccepted', { count: rejected })
      : outboxCount > 0
        ? t('sync.waiting', { count: outboxCount })
        : t('sync.allSynced');

  const lastSync = state.lastSyncAt
    ? t('sync.lastSync', {
        time: new Intl.DateTimeFormat(intlLocale(i18n.language), {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(state.lastSyncAt)),
      })
    : t('sync.neverSynced');

  const tableLabel = (table: string) => (isSyncTable(table) ? t(`sync.table.${table}`) : table);
  const fieldLabel = (field: string) => t(`sync.field.${field}`, { defaultValue: field });

  const errorText = (error: SyncErrorRow) => {
    if (error.code === 'clock_ahead') return t('sync.clockAhead');
    if (error.field) return t('sync.fieldRejected', { field: fieldLabel(error.field) });
    return knownCode(error.code) ? t(`sync.error.${error.code}`) : t('sync.error.generic');
  };

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('sync.title')}</h1>

      <div
        role="status"
        data-level={health.level}
        data-tone={tone}
        className={`space-y-1 rounded-2xl border p-4 ${LEVEL_BOX[tone]}`}
      >
        <p className="font-semibold">{headline}</p>
        {rejected > 0 && outboxCount > 0 && <p>{t('sync.waiting', { count: outboxCount })}</p>}
        {held && held.count > 0 && (
          <p>{t('sync.heldForServer', { count: held.count, units: held.units.join(', ') })}</p>
        )}
        {health.reasons
          // The headline already says these.
          .filter((reason) => reason !== 'pending' && reason !== 'rejected_entries')
          .map((reason) => (
            <p key={reason}>{t(`sync.reason.${reason}`)}</p>
          ))}
      </div>

      {state.authProblem === 'auth_required' && (
        // Re-sign-in keeps the device and its data (completeSignIn); never an automatic sign-out.
        <Link
          to="/sign-in"
          className="flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-4 font-semibold text-primary-fg"
        >
          {t('sync.signInAgain')}
        </Link>
      )}

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

      {queuedOffline && rejected === 0 && (
        <p role="status" className="text-muted">
          {t('sync.queuedOffline')}
        </p>
      )}

      {rejected > 0 && (
        <div className="space-y-3 rounded-2xl border border-warning bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-warning-fg">{t('sync.rejectedTitle')}</h2>
            {canRetry && rejected > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retry(errors.map((e) => e.id))}
                className="min-h-11 rounded-md border border-border px-4 font-semibold text-text disabled:opacity-50"
              >
                {t('sync.tryAllAgain')}
              </button>
            )}
          </div>
          <p className="text-muted">{t('sync.rejectedIntro')}</p>
          {!canRetry && <p className="font-medium">{t('sync.ownerReview')}</p>}
          <ul className="divide-y divide-border">
            {errors.map((error) => {
              const name = syncRecordName(error.table, error.row);
              const table = tableLabel(error.table);
              return (
                <li
                  key={error.id}
                  data-testid="rejected-entry"
                  className="flex items-start gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{name ?? table}</p>
                    {name && <p className="text-sm text-muted">{table}</p>}
                    <p className="text-warning-fg">{errorText(error)}</p>
                  </div>
                  {canRetry && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={t('sync.tryAgainLabel', { name: name ?? table })}
                      onClick={() => void retry([error.id])}
                      className="min-h-11 shrink-0 rounded-md bg-primary px-4 font-semibold text-primary-fg disabled:opacity-50"
                    >
                      {t('sync.tryAgain')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
