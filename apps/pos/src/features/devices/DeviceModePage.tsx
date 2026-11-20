import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { syncEngine } from '../../sync/index.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { errorMessageKey } from '../../ui/errors.ts';
import { DeviceModeField } from '../onboarding/DeviceModeField.tsx';
import type { SetupMode } from '../onboarding/setup.ts';
import { changeDeviceMode } from './deviceMode.ts';

/** Settings → Device mode (owner screen): owner phone ↔ shop counter. */
export function DeviceModePage() {
  const current = useLiveQuery(async () => {
    const mode = (await getStoredDevice())?.mode ?? 'shop';
    return mode === 'owner' ? 'owner' : 'shop';
  });
  if (!current) return null;
  // Not keyed on the mode: the success message stays after the mode changes.
  return <ModeForm current={current} />;
}

function ModeForm({ current }: { current: SetupMode }) {
  const { t } = useTranslation();
  const pending = useLiveQuery(() => db.outbox.count());
  const [mode, setMode] = useState<SetupMode>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{t('deviceMode.title')}</h1>
      <p className="text-muted">
        {t('deviceMode.current', {
          mode: t(current === 'owner' ? 'device.modeOwner' : 'device.modeShop'),
        })}
      </p>
      {done && <Alert tone="info">{t('deviceMode.done')}</Alert>}
      {error && <Alert>{error}</Alert>}
      <DeviceModeField value={mode} onChange={setMode} />
      {pending !== undefined && pending > 0 ? (
        <>
          {/* The mode decides what may sync; waiting changes must go up under the old one. */}
          <Alert>{t('deviceMode.syncFirst', { count: pending })}</Alert>
          <Button disabled={busy} onClick={() => void act(() => syncEngine.syncNow())}>
            {busy ? t('sync.syncing') : t('sync.syncNow')}
          </Button>
        </>
      ) : (
        <Button
          disabled={busy || pending === undefined || mode === current}
          onClick={() =>
            void act(async () => {
              await changeDeviceMode(mode);
              setDone(true);
            })
          }
        >
          {busy ? t('common.wait') : t('deviceMode.change')}
        </Button>
      )}
    </section>
  );
}
