import { uuidv7, type ShopRow } from '@naqdpos/core';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../ui/Button.tsx';
import { errorMessageKey } from '../../ui/errors.ts';
import { Field } from '../../ui/Field.tsx';
import { registerThisDevice } from './setup.ts';

/** An owner who already has a shop signs in on a new device: register it, nothing else. */
export function RegisterDeviceForm({ shop, onDone }: { shop: ShopRow; onDone: () => void }) {
  const { t } = useTranslation();
  const deviceId = useRef(uuidv7());
  const [name, setName] = useState(t('device.defaultName'));
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setFieldError(t('onboarding.required'));
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await registerThisDevice({ deviceId: deviceId.current, shopId: shop.id, name: name.trim() });
      onDone();
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="text-2xl font-bold">{t('device.registerTitle')}</h1>
      <p className="text-gray-600">{t('device.registerIntro', { shop: shop.name })}</p>
      {error && <Alert>{error}</Alert>}
      <Field
        label={t('device.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fieldError}
        hint={t('device.nameHint')}
        required
      />
      <Button type="submit" disabled={busy}>
        {busy ? t('common.wait') : t('device.register')}
      </Button>
    </form>
  );
}
