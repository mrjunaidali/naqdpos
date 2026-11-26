// Live sync health for the badge, banners and Sync screen: Dexie (outbox, errors, sync state)
// plus online status and storage, fed into syncHealth() from packages/core (architecture §7).
import { isPullProblem, syncHealth, type SyncHealth } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useOnline } from '../app/useOnline.ts';
import { db } from '../db/schema.ts';
import { EMPTY_SYNC_STATE, readSyncState, type SyncState } from './state.ts';

const STORAGE_CHECK_MS = 30 * 60 * 1000;

export interface SyncStatus {
  health: SyncHealth;
  outboxCount: number;
  errorCount: number;
  /** Pulled rows this app could not store (sync_errors with op 'pull'). */
  pullProblemCount: number;
  state: SyncState;
  isOnline: boolean;
}

interface StorageInfo {
  persisted: boolean | null;
  usedRatio: number | null;
}

async function readStorage(): Promise<StorageInfo> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  try {
    const persisted = storage?.persisted ? await storage.persisted() : null;
    const estimate = storage?.estimate ? await storage.estimate() : undefined;
    const usedRatio =
      estimate?.usage !== undefined && estimate.quota ? estimate.usage / estimate.quota : null;
    return { persisted, usedRatio };
  } catch {
    return { persisted: null, usedRatio: null };
  }
}

/** Storage on start and every 30 minutes (architecture §6). */
function useStorageInfo(): StorageInfo {
  const [info, setInfo] = useState<StorageInfo>({ persisted: null, usedRatio: null });
  useEffect(() => {
    let alive = true;
    const load = () => void readStorage().then((next) => alive && setInfo(next));
    load();
    const id = setInterval(load, STORAGE_CHECK_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return info;
}

/** Re-evaluates the age thresholds every minute even when nothing in Dexie changes. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function useSyncStatus(): SyncStatus {
  const isOnline = useOnline();
  const storage = useStorageInfo();
  const now = useMinuteClock();
  const data = useLiveQuery(async () => {
    const [outboxCount, oldest, unsyncedSalesCount, errors, state] = await Promise.all([
      db.outbox.count(),
      db.outbox.orderBy('id').first(),
      db.outbox.where('table').equals('sales').count(),
      db.sync_errors.toArray(),
      readSyncState(db),
    ]);
    return {
      outboxCount,
      oldestAt: oldest?.created_at ?? null,
      unsyncedSalesCount,
      errorCount: errors.filter((e) => !isPullProblem(e)).length,
      pullProblemCount: errors.filter((e) => isPullProblem(e)).length,
      state,
    };
  });

  const outboxCount = data?.outboxCount ?? 0;
  const errorCount = data?.errorCount ?? 0;
  const pullProblemCount = data?.pullProblemCount ?? 0;
  const state = data?.state ?? EMPTY_SYNC_STATE;
  const health = syncHealth({
    outboxCount,
    oldestOutboxAt: data?.oldestAt ?? null,
    unsyncedSalesCount: data?.unsyncedSalesCount ?? 0,
    errorCount,
    pullProblemCount,
    isOnline,
    lastSyncAt: state.lastSyncAt,
    storagePersisted: storage.persisted,
    storageUsedRatio: storage.usedRatio,
    updateRequired: state.updateRequired !== null,
    authProblem: state.authProblem,
    now,
  });
  return { health, outboxCount, errorCount, pullProblemCount, state, isOnline };
}
