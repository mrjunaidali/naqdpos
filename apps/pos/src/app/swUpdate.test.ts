import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  setRegistration,
  startUpdateChecks,
  UPDATE_CHECK_INTERVAL_MS,
} from './swUpdate.ts';

function fakeWindow() {
  const target = new EventTarget();
  const intervals: { fn: () => void; ms: number }[] = [];
  return {
    target,
    intervals,
    win: {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      setInterval: (fn: () => void, ms: number) => intervals.push({ fn, ms }),
      clearInterval: vi.fn(),
    } as unknown as Window,
  };
}

function fakeDocument(state: DocumentVisibilityState) {
  const target = new EventTarget();
  return {
    target,
    doc: {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      get visibilityState() {
        return state;
      },
    } as unknown as Document,
    setState(next: DocumentVisibilityState) {
      state = next;
    },
  };
}

afterEach(() => setRegistration(null));

describe('service-worker update checks (architecture §6)', () => {
  it('checks every 60 minutes, on focus and when the window becomes visible', async () => {
    const update = vi.fn(() => Promise.resolve());
    setRegistration({ update });
    const w = fakeWindow();
    const d = fakeDocument('hidden');
    const stop = startUpdateChecks({ win: w.win, doc: d.doc, isOnline: () => true });

    expect(w.intervals.map((i) => i.ms)).toEqual([UPDATE_CHECK_INTERVAL_MS]);
    w.intervals[0]!.fn();
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    w.target.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));

    d.target.dispatchEvent(new Event('visibilitychange')); // still hidden: no check
    d.setState('visible');
    d.target.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(3));

    stop();
    w.target.dispatchEvent(new Event('focus'));
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('skips the check offline and swallows failures', async () => {
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    setRegistration({ update });
    await checkForUpdate(() => false);
    expect(update).not.toHaveBeenCalled();
    await expect(checkForUpdate(() => true)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledOnce();
  });

  it('does nothing before the service worker is registered', async () => {
    await expect(checkForUpdate(() => true)).resolves.toBeUndefined();
  });
});
