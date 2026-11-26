// Sync chip (docs/design-theme.md, Screens): green "Synced", amber "N pending", red "Needs review".
// Tap opens the Sync screen. Reads Dexie only; never blocks anything.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { chipTone, type SyncTone } from './tone.ts';
import { useSyncStatus } from './useSyncStatus.ts';

const DOT: Record<SyncTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function SyncChip() {
  const { t } = useTranslation();
  const { health, outboxCount, pullProblemCount } = useSyncStatus();
  const tone = chipTone(health.level);
  const label =
    tone === 'success'
      ? t('sync.synced')
      : tone === 'danger'
        ? t('sync.needsReview')
        : outboxCount > 0
          ? t('sync.pending', { count: outboxCount })
          : pullProblemCount > 0
            ? t('sync.checkSync')
            : t('sync.paused');

  return (
    <Link
      to="/sync"
      data-tone={tone}
      aria-label={t('sync.openSync', { status: label })}
      className="inline-flex min-h-11 min-w-11 shrink items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm font-medium text-text"
    >
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}
