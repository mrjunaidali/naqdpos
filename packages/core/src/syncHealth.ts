// Sync health (architecture §7): one pure function decides how loudly the app nags about unsynced
// data. Thresholds live here and nowhere else. Selling never waits for any of this (rule 1).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const SYNC_THRESHOLDS = {
  /** pending → reminder once the oldest unsynced entry is this old. */
  reminderAgeMs: 2 * HOUR,
  /** Reminder every N unsynced sales. */
  reminderSales: 25,
  warningAgeMs: 12 * HOUR,
  warningSales: 100,
  warningStorageRatio: 0.8,
  criticalAgeMs: 24 * HOUR,
  criticalStorageRatio: 0.95,
} as const;

export const SYNC_LEVELS = ['ok', 'pending', 'reminder', 'warning', 'critical'] as const;
export type SyncLevel = (typeof SYNC_LEVELS)[number];

/** Why sync is paused without retrying (the engine stores it): needs the user, not time. */
export type SyncAuthProblem = 'auth_required' | 'device_unlinked';

export type SyncReason =
  | 'pending'
  | 'sales_reminder'
  | 'age_2h'
  | 'age_12h'
  | 'sales_100'
  | 'storage_not_persisted'
  | 'storage_80'
  | 'update_required'
  | 'auth_required'
  | 'device_unlinked'
  | 'age_24h'
  | 'storage_95'
  | 'rejected_entries'
  | 'pull_skipped';

export interface SyncHealthInput {
  outboxCount: number;
  /** created_at (ms or ISO) of the oldest outbox entry; null when the outbox is empty. */
  oldestOutboxAt: number | string | null;
  unsyncedSalesCount: number;
  /** Entries the server rejected (sync_errors, pushes only). */
  errorCount: number;
  /**
   * Pulled rows this app could not store (sync_errors with op 'pull'): a warning, not critical,
   * because the data is safe on the server. Optional for callers from before 26 Nov 2026.
   */
  pullProblemCount?: number;
  isOnline: boolean;
  lastSyncAt: number | string | null;
  /** navigator.storage.persisted(); null when unknown (treated as persisted, no false alarm). */
  storagePersisted: boolean | null;
  /** usage / quota from navigator.storage.estimate(); null when unknown. */
  storageUsedRatio: number | null;
  /** The API answered 426 (§4): sync paused until the app is reloaded. */
  updateRequired: boolean;
  /** 401 / 403 from sync: paused until the user signs in again or the device is re-linked. */
  authProblem?: SyncAuthProblem | null;
  now: number;
}

export interface SyncHealth {
  level: SyncLevel;
  /** Every condition that holds, most severe first. */
  reasons: SyncReason[];
}

const ms = (t: number | string) => (typeof t === 'number' ? t : Date.parse(t));

export function syncHealth(input: SyncHealthInput): SyncHealth {
  const T = SYNC_THRESHOLDS;
  const found: [SyncLevel, SyncReason][] = [];
  const add = (level: SyncLevel, reason: SyncReason, when: boolean) => {
    if (when) found.push([level, reason]);
  };

  const age =
    input.outboxCount > 0 && input.oldestOutboxAt !== null
      ? input.now - ms(input.oldestOutboxAt)
      : 0;
  const ratio = input.storageUsedRatio ?? 0;
  const unsynced = input.outboxCount > 0;

  add('critical', 'rejected_entries', input.errorCount > 0);
  add('critical', 'age_24h', age >= T.criticalAgeMs);
  add('critical', 'storage_95', ratio >= T.criticalStorageRatio);

  add('warning', 'update_required', input.updateRequired);
  add('warning', 'auth_required', input.authProblem === 'auth_required');
  add('warning', 'device_unlinked', input.authProblem === 'device_unlinked');
  add('warning', 'age_12h', age >= T.warningAgeMs && age < T.criticalAgeMs);
  add('warning', 'sales_100', input.unsyncedSalesCount >= T.warningSales);
  add('warning', 'storage_not_persisted', unsynced && input.storagePersisted === false);
  add('warning', 'pull_skipped', (input.pullProblemCount ?? 0) > 0);
  add('warning', 'storage_80', ratio >= T.warningStorageRatio && ratio < T.criticalStorageRatio);

  add('reminder', 'age_2h', age >= T.reminderAgeMs && age < T.warningAgeMs);
  add(
    'reminder',
    'sales_reminder',
    input.unsyncedSalesCount >= T.reminderSales && input.unsyncedSalesCount < T.warningSales,
  );

  add('pending', 'pending', unsynced);

  if (found.length === 0) return { level: 'ok', reasons: [] };
  const rank = (level: SyncLevel) => SYNC_LEVELS.indexOf(level);
  found.sort((a, b) => rank(b[0]) - rank(a[0]));
  return { level: found[0]![0], reasons: found.map(([, reason]) => reason) };
}
