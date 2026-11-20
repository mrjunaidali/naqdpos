// Service-worker update checks (architecture §6). Browsers only look for a new sw.js when the
// app is opened or navigated, and shop PCs stay open for days, so the app also asks every 60
// minutes while online, whenever the window becomes visible or regains focus, and at once when
// the API answers 426 (§4). Reloading is still the user's choice (UpdatePrompt).

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The part of ServiceWorkerRegistration this module uses. */
interface Registration {
  update(): Promise<unknown>;
}

let registration: Registration | null = null;
let applyUpdate: (() => Promise<void>) | null = null;

/** Called once the service worker is registered (UpdatePrompt). */
export function setRegistration(value: Registration | null): void {
  registration = value;
}

/** The waiting service worker's activate-and-reload, when one is waiting. */
export function setApplyUpdate(fn: (() => Promise<void>) | null): void {
  applyUpdate = fn;
}

export async function checkForUpdate(isOnline: () => boolean = () => navigator.onLine) {
  if (!registration || !isOnline()) return;
  try {
    await registration.update();
  } catch {
    // Offline or the server is down: the next trigger tries again.
  }
}

/** Activates a waiting new version if there is one, otherwise just reloads. */
export async function reloadApp(): Promise<void> {
  if (applyUpdate) await applyUpdate();
  else window.location.reload();
}

interface CheckDeps {
  win?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'>;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  isOnline?: () => boolean;
}

/** Starts the periodic and visibility/focus checks; returns a stop function. */
export function startUpdateChecks(deps: CheckDeps = {}): () => void {
  const win = deps.win ?? window;
  const doc = deps.doc ?? document;
  const isOnline = deps.isOnline ?? (() => navigator.onLine);
  const check = () => void checkForUpdate(isOnline);
  const onVisible = () => {
    if (doc.visibilityState === 'visible') check();
  };
  const interval = win.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('focus', check);
  return () => {
    win.clearInterval(interval);
    doc.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('focus', check);
  };
}
