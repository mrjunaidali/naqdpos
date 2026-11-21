import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '../db/schema.ts';
import { Button } from '../ui/Button.tsx';
import {
  browserInstallEnv,
  INSTALL_DISMISSED_KEY,
  installState,
  useInstallStore,
} from './install.ts';

/**
 * "Install app" (US001): the browser's install prompt where it exists, otherwise the platform's
 * guide. Hidden when already installed. On Home it can be dismissed (Settings keeps it).
 */
export function InstallCard({ dismissible }: { dismissible: boolean }) {
  const { t } = useTranslation();
  const prompt = useInstallStore((s) => s.prompt);
  const installed = useInstallStore((s) => s.installed);
  const dismissed = useLiveQuery(
    async () => (await db.meta.get(INSTALL_DISMISSED_KEY))?.value === true,
  );
  const state = installed ? 'installed' : installState(browserInstallEnv(prompt !== null));
  if (state === 'installed' || state === 'none') return null;
  if (dismissible && dismissed !== false) return null;

  return (
    <div
      className="space-y-2 rounded-2xl border border-border bg-surface p-4"
      role="region"
      aria-label={t('install.title')}
    >
      <p className="font-semibold">{t('install.title')}</p>
      <p className="text-sm text-muted">{t(`install.${state}`)}</p>
      <div className="flex gap-2">
        {state === 'prompt' && (
          <Button
            className="w-auto"
            onClick={() => {
              void prompt?.prompt();
              void prompt?.userChoice.then((c) => {
                if (c.outcome === 'accepted') useInstallStore.getState().markInstalled();
              });
            }}
          >
            {t('install.button')}
          </Button>
        )}
        {dismissible && (
          <Button
            className="w-auto"
            variant="secondary"
            onClick={() => void db.meta.put({ key: INSTALL_DISMISSED_KEY, value: true })}
          >
            {t('install.notNow')}
          </Button>
        )}
      </div>
    </div>
  );
}
