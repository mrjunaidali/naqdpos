import { describe, expect, it } from 'vitest';
import { SYNC_THRESHOLDS, syncHealth, type SyncHealthInput } from './syncHealth.ts';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function input(overrides: Partial<SyncHealthInput> = {}): SyncHealthInput {
  return {
    outboxCount: 0,
    oldestOutboxAt: null,
    unsyncedSalesCount: 0,
    errorCount: 0,
    isOnline: true,
    lastSyncAt: NOW - MIN,
    storagePersisted: true,
    storageUsedRatio: 0.1,
    updateRequired: false,
    authProblem: null,
    now: NOW,
    ...overrides,
  };
}

/** Outbox with entries, the oldest `ageMs` old. */
const aged = (ageMs: number, extra: Partial<SyncHealthInput> = {}) =>
  input({ outboxCount: 3, oldestOutboxAt: NOW - ageMs, ...extra });

describe('syncHealth (architecture §7)', () => {
  it('is ok with an empty outbox and no errors', () => {
    expect(syncHealth(input())).toEqual({ level: 'ok', reasons: [] });
  });

  it('is pending while the oldest entry is young', () => {
    expect(syncHealth(aged(29 * MIN))).toEqual({ level: 'pending', reasons: ['pending'] });
  });

  it('accepts ISO timestamps too', () => {
    const iso = new Date(NOW - 3 * HOUR).toISOString();
    expect(syncHealth(input({ outboxCount: 1, oldestOutboxAt: iso })).level).toBe('reminder');
  });

  it.each([
    [2 * HOUR - 1, 'pending'],
    [2 * HOUR, 'reminder'],
    [12 * HOUR - 1, 'reminder'],
    [12 * HOUR, 'warning'],
    [24 * HOUR - 1, 'warning'],
    [24 * HOUR, 'critical'],
  ] as const)('oldest entry %i ms old → %s', (age, level) => {
    expect(syncHealth(aged(age)).level).toBe(level);
  });

  it.each([
    [24, 'pending'],
    [25, 'reminder'],
    [99, 'reminder'],
    [100, 'warning'],
  ] as const)('%i unsynced sales → %s', (sales, level) => {
    expect(syncHealth(aged(MIN, { unsyncedSalesCount: sales })).level).toBe(level);
  });

  it.each([
    [0.79, 'ok'],
    [0.8, 'warning'],
    [0.94, 'warning'],
    [0.95, 'critical'],
  ] as const)('storage %f used → %s', (ratio, level) => {
    expect(syncHealth(input({ storageUsedRatio: ratio })).level).toBe(level);
  });

  it('warns when storage is not persisted only while data is unsynced', () => {
    expect(syncHealth(input({ storagePersisted: false })).level).toBe('ok');
    expect(syncHealth(aged(MIN, { storagePersisted: false }))).toEqual({
      level: 'warning',
      reasons: ['storage_not_persisted', 'pending'],
    });
    expect(syncHealth(aged(MIN, { storagePersisted: null })).level).toBe('pending');
  });

  it('treats update required as at least a warning, even with an empty outbox', () => {
    expect(syncHealth(input({ updateRequired: true }))).toEqual({
      level: 'warning',
      reasons: ['update_required'],
    });
  });

  it('treats auth problems as warnings with their own reason', () => {
    expect(syncHealth(aged(MIN, { authProblem: 'auth_required' })).reasons).toEqual([
      'auth_required',
      'pending',
    ]);
    expect(syncHealth(input({ authProblem: 'device_unlinked' }))).toEqual({
      level: 'warning',
      reasons: ['device_unlinked'],
    });
  });

  it('is critical with any rejected entry', () => {
    expect(syncHealth(input({ errorCount: 1 }))).toEqual({
      level: 'critical',
      reasons: ['rejected_entries'],
    });
  });

  it('is a warning (not critical) with pulled rows this app could not store', () => {
    expect(syncHealth(input({ pullProblemCount: 2 }))).toEqual({
      level: 'warning',
      reasons: ['pull_skipped'],
    });
    expect(syncHealth(input({ pullProblemCount: 0 })).level).toBe('ok');
  });

  it('lists every reason, most severe first', () => {
    const result = syncHealth(
      aged(13 * HOUR, { errorCount: 2, updateRequired: true, unsyncedSalesCount: 30 }),
    );
    expect(result.level).toBe('critical');
    expect(result.reasons).toEqual([
      'rejected_entries',
      'update_required',
      'age_12h',
      'sales_reminder',
      'pending',
    ]);
  });

  it('keeps the thresholds in one exported place', () => {
    expect(SYNC_THRESHOLDS).toMatchObject({ reminderSales: 25, warningSales: 100 });
  });
});
