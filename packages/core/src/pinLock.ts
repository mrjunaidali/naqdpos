// PIN lock (architecture §5, US016): after 5 wrong PINs the keypad locks for 1 minute. Counted per
// device across all staff, so nobody gets 5 guesses at each person's PIN. Pure: the app keeps the
// state in Dexie meta, so a reload does not reset it.

export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 60_000;

export interface PinLockState {
  failures: number;
  /** ms epoch until which the keypad is locked; null when not locked. */
  lockedUntil: number | null;
}

export const PIN_LOCK_OPEN: PinLockState = { failures: 0, lockedUntil: null };

export function isPinLocked(state: PinLockState, now: number): boolean {
  return state.lockedUntil !== null && now < state.lockedUntil;
}

export function pinLockRemainingMs(state: PinLockState, now: number): number {
  return isPinLocked(state, now) ? state.lockedUntil! - now : 0;
}

/** A wrong PIN. The 5th in a row locks; the count starts again after the lock. */
export function recordPinFailure(state: PinLockState, now: number): PinLockState {
  if (isPinLocked(state, now)) return state;
  // An expired lock starts a fresh count.
  const failures = (state.lockedUntil !== null ? 0 : state.failures) + 1;
  return failures >= PIN_MAX_FAILURES
    ? { failures: 0, lockedUntil: now + PIN_LOCK_MS }
    : { failures, lockedUntil: null };
}

/** A correct PIN clears the count. */
export function recordPinSuccess(): PinLockState {
  return PIN_LOCK_OPEN;
}
