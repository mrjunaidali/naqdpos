import { isPinLocked, pinLockRemainingMs } from '@naqdpos/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { attemptPin, type PinAttemptResult } from './pinAttempt.ts';
import { usePinLock } from './useSwitchableStaff.ts';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** The clock, ticking every second until `until` passes (lock countdown, then unlock). */
function useNow(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const next = Date.now();
      setNow(next);
      if (next >= until) clearInterval(id);
    };
    const id = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [until]);
  return now;
}

interface Props {
  staffId: string;
  staffName: string;
  /** Only these roles may unlock (e.g. owners for an owner screen). */
  roles?: readonly string[];
  onSuccess: () => void;
}

/** 4-digit keypad (44px+ keys) that checks the PIN offline and shows the 1-minute lock. */
export function PinPad({ staffId, staffName, roles, onSuccess }: Props) {
  const { t } = useTranslation();
  const lock = usePinLock();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PinAttemptResult>();
  const now = useNow(lock?.lockedUntil ?? null);
  const locked = lock !== undefined && isPinLocked(lock, now);
  const remaining = lock ? Math.ceil(pinLockRemainingMs(lock, now) / 1000) : 0;

  async function submit(full: string) {
    setBusy(true);
    try {
      const outcome = await attemptPin(staffId, full, roles ? { roles } : {});
      setResult(outcome);
      setPin('');
      if (outcome.status === 'ok') onSuccess();
    } finally {
      setBusy(false);
    }
  }

  function press(key: string) {
    if (busy || locked || pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  const message =
    locked && remaining > 0
      ? t('pin.locked', { seconds: remaining })
      : result?.status === 'wrong'
        ? t('pin.wrong', { count: result.left })
        : result?.status === 'not_allowed'
          ? t('pin.notAllowed')
          : null;

  return (
    <div className="space-y-4">
      <p className="text-center font-medium">{t('pin.enterFor', { name: staffName })}</p>
      <div
        className="flex justify-center gap-3"
        aria-label={t('pin.entered', { count: pin.length })}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`size-4 rounded-full border border-text ${i < pin.length ? 'bg-text' : ''}`}
          />
        ))}
      </div>
      <p role="alert" className="min-h-6 text-center text-danger-fg">
        {message}
      </p>
      <div className="mx-auto grid max-w-xs grid-cols-3 gap-2" dir="ltr">
        {KEYS.map((key) => (
          <PadKey key={key} label={key} onClick={() => press(key)} disabled={busy || locked} />
        ))}
        <span />
        <PadKey label="0" onClick={() => press('0')} disabled={busy || locked} />
        <PadKey
          label="⌫"
          ariaLabel={t('pin.backspace')}
          onClick={() => setPin((p) => p.slice(0, -1))}
          disabled={busy || locked || pin.length === 0}
        />
      </div>
    </div>
  );
}

function PadKey(props: {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel ?? props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="min-h-14 rounded-xl border border-border bg-surface text-2xl font-semibold text-text disabled:opacity-40"
    >
      {props.label}
    </button>
  );
}
