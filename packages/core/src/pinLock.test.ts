import { describe, expect, it } from 'vitest';
import {
  isPinLocked,
  normalizePinLock,
  PIN_LOCK_OPEN,
  PIN_LOCK_STEPS_MS,
  pinLockDurationMs,
  pinLockRemainingMs,
  recordPinFailure,
  recordPinSuccess,
  type PinLockState,
} from './pinLock.ts';

const T0 = 1_700_000_000_000;
const failTimes = (n: number, start: PinLockState = PIN_LOCK_OPEN, now = T0) => {
  let state = start;
  for (let i = 0; i < n; i++) state = recordPinFailure(state, now);
  return state;
};

/** Runs `count` full lockouts, each started right after the previous one ended. */
function lockouts(count: number) {
  let state = PIN_LOCK_OPEN;
  let now = T0;
  const lengths: number[] = [];
  for (let i = 0; i < count; i++) {
    state = failTimes(5, state, now);
    lengths.push(state.lockedUntil! - now);
    now = state.lockedUntil!;
  }
  return { state, now, lengths };
}

describe('PIN lock: 5 wrong tries, escalating lockouts', () => {
  it('keeps the steps in one place', () => {
    expect(PIN_LOCK_STEPS_MS).toEqual([60_000, 300_000, 900_000]);
  });

  it('stays open for 4 wrong PINs', () => {
    const state = failTimes(4);
    expect(state).toEqual({ failures: 4, lockedUntil: null, lockouts: 0 });
    expect(isPinLocked(state, T0)).toBe(false);
  });

  it('locks for 1 minute the first time', () => {
    const state = failTimes(5);
    expect(state).toEqual({ failures: 0, lockedUntil: T0 + 60_000, lockouts: 1 });
    expect(isPinLocked(state, T0 + 59_999)).toBe(true);
    expect(pinLockRemainingMs(state, T0 + 15_000)).toBe(45_000);
    expect(isPinLocked(state, T0 + 60_000)).toBe(false);
  });

  it('locks for 5 minutes the second time, then 15 minutes every further time', () => {
    expect(lockouts(5).lengths).toEqual([60_000, 300_000, 900_000, 900_000, 900_000]);
    expect(pinLockDurationMs(9)).toBe(900_000);
  });

  it('ignores attempts while locked', () => {
    const locked = failTimes(5);
    expect(recordPinFailure(locked, T0 + 1000)).toBe(locked);
  });

  it('starts a fresh count after a lock ends, keeping the lockout level', () => {
    const after = recordPinFailure(failTimes(5), T0 + 60_000);
    expect(after).toEqual({ failures: 1, lockedUntil: T0 + 60_000, lockouts: 1 });
    expect(isPinLocked(after, T0 + 60_000)).toBe(false);
  });

  it('a correct PIN resets the failures and the lockout level', () => {
    const { now } = lockouts(3);
    expect(recordPinSuccess()).toEqual(PIN_LOCK_OPEN);
    const again = failTimes(5, recordPinSuccess(), now);
    expect(again.lockedUntil! - now).toBe(60_000);
  });

  it('loads states saved before the lockout level existed', () => {
    expect(normalizePinLock({ failures: 3, lockedUntil: null })).toEqual({
      failures: 3,
      lockedUntil: null,
      lockouts: 0,
    });
    expect(normalizePinLock(undefined)).toEqual(PIN_LOCK_OPEN);
    expect(normalizePinLock('junk')).toEqual(PIN_LOCK_OPEN);
  });
});
