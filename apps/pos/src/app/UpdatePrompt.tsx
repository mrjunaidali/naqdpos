import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { NewVersionBanner } from './NewVersionBanner.tsx';
import { setApplyUpdate, setRegistration, startUpdateChecks } from './swUpdate.ts';

let stopChecks: (() => void) | null = null;

/**
 * Registers the service worker (registerType 'prompt': never auto-reloads, architecture §6) and
 * starts the update checks. The banner itself is NewVersionBanner.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setRegistration(registration);
      stopChecks?.();
      stopChecks = startUpdateChecks();
    },
  });

  // The "update required" banner reloads through the waiting worker when there is one.
  useEffect(() => {
    setApplyUpdate(needRefresh ? () => updateServiceWorker(true) : null);
  }, [needRefresh, updateServiceWorker]);

  return (
    <NewVersionBanner
      visible={needRefresh}
      onLater={() => setNeedRefresh(false)}
      onReload={() => void updateServiceWorker(true)}
    />
  );
}
