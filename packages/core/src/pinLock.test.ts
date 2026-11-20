import { describe, expect, it } from 'vitest';
import {
  isPinLocked,
  PIN_LOCK_MS,
  PIN_LOCK_OPEN,
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

describe('PIN lock (5 wrong tries → 1 minute)', () => {
  it('stays open for 4 wrong PINs', () => {
    const state = failTimes(4);
    expect(state).toEqual({ failures: 4, lockedUntil: null });
    expect(isPinLocked(state, T0)).toBe(false);
  });

  it('locks on the 5th for exactly one minute', () => {
    const state = failTimes(5);
    expect(state.lockedUntil).toBe(T0 + PIN_LOCK_MS);
    expect(isPinLocked(state, T0 + PIN_LOCK_MS - 1)).toBe(true);
    expect(pinLockRemainingMs(state, T0 + 15_000)).toBe(45_000);
    expect(isPinLocked(state, T0 + PIN_LOCK_MS)).toBe(false);
    expect(pinLockRemainingMs(state, T0 + PIN_LOCK_MS)).toBe(0);
  });

  it('ignores attempts while locked', () => {
    const locked = failTimes(5);
    expect(recordPinFailure(locked, T0 + 1000)).toBe(locked);
  });

  it('starts a fresh count after the lock ends', () => {
    const after = recordPinFailure(failTimes(5), T0 + PIN_LOCK_MS);
    expect(after).toEqual({ failures: 1, lockedUntil: null });
  });

  it('a correct PIN resets the count', () => {
    expect(recordPinSuccess()).toEqual(PIN_LOCK_OPEN);
    expect(failTimes(4, recordPinSuccess()).lockedUntil).toBeNull();
  });
});
