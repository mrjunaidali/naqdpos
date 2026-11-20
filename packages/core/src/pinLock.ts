// PIN lock (architecture §5, US016): 5 wrong PINs lock the keypad, longer each time: 1 minute,
// then 5 minutes, then 15 minutes for every further lockout. A correct PIN resets everything.
// Counted per device across all staff, so nobody gets 5 guesses at each person's PIN. Pure: the
// app keeps the state in Dexie meta, so a reload does not reset it.

export const PIN_MAX_FAILURES = 5;
/** Lockout lengths: 1st, 2nd, and every further lockout. */
export const PIN_LOCK_STEPS_MS = [60_000, 300_000, 900_000] as const;

export interface PinLockState {
  /** Wrong PINs since the last lockout or success. */
  failures: number;
  /** ms epoch until which the keypad is locked; null when not locked. */
  lockedUntil: number | null;
  /** Lockouts since the last correct PIN; picks the next lock length. */
  lockouts: number;
}

export const PIN_LOCK_OPEN: PinLockState = { failures: 0, lockedUntil: null, lockouts: 0 };

/** Reads a stored state; states saved before `lockouts` existed count as no lockouts yet. */
export function normalizePinLock(value: unknown): PinLockState {
  if (typeof value !== 'object' || value === null) return PIN_LOCK_OPEN;
  const v = value as Partial<PinLockState>;
  return {
    failures: typeof v.failures === 'number' ? v.failures : 0,
    lockedUntil: typeof v.lockedUntil === 'number' ? v.lockedUntil : null,
    lockouts: typeof v.lockouts === 'number' ? v.lockouts : 0,
  };
}

/** Length of the lockout with this number (1-based); stays at the last step. */
export function pinLockDurationMs(lockout: number): number {
  const steps = PIN_LOCK_STEPS_MS;
  return steps[Math.min(Math.max(lockout, 1), steps.length) - 1]!;
}

export function isPinLocked(state: PinLockState, now: number): boolean {
  return state.lockedUntil !== null && now < state.lockedUntil;
}

export function pinLockRemainingMs(state: PinLockState, now: number): number {
  return isPinLocked(state, now) ? state.lockedUntil! - now : 0;
}

/** A wrong PIN. The 5th in a row locks for the next step; the count starts again after it. */
export function recordPinFailure(state: PinLockState, now: number): PinLockState {
  if (isPinLocked(state, now)) return state;
  const failures = state.failures + 1;
  if (failures < PIN_MAX_FAILURES) return { ...state, failures };
  const lockouts = state.lockouts + 1;
  return { failures: 0, lockedUntil: now + pinLockDurationMs(lockouts), lockouts };
}

/** A correct PIN clears the count and the lockout level. */
export function recordPinSuccess(): PinLockState {
  return PIN_LOCK_OPEN;
}
