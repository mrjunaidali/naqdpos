import { hashPin, isValidPin, uuidv7, type ShopRow } from '@naqdpos/core';
import { api } from '../../api/index.ts';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../ui/Button.tsx';
import { errorMessageKey } from '../../ui/errors.ts';
import { Field } from '../../ui/Field.tsx';
import { DeviceModeField } from './DeviceModeField.tsx';
import { defaultDeviceName, registerThisDevice, type SetupMode } from './setup.ts';

/**
 * An owner who already has a shop signs in on a new device: register it. An invited owner
 * without a PIN (ownerStaffId set) sets their first PIN next, hashed here (US012).
 */
export function RegisterDeviceForm({
  shop,
  ownerStaffId = null,
  onDone,
}: {
  shop: ShopRow;
  ownerStaffId?: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const deviceId = useRef(uuidv7());
  const [mode, setMode] = useState<SetupMode>('shop');
  const [name, setName] = useState(defaultDeviceName('shop', t));
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'device' | 'pin'>('device');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinErrors, setPinErrors] = useState<{ pin?: string; pinConfirm?: string }>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setFieldError(t('onboarding.required'));
      return;
    }
    setFieldError(undefined);
    if (ownerStaffId && step === 'device') {
      setStep('pin');
      return;
    }
    let ownerPinHash: string | undefined;
    if (ownerStaffId) {
      const found: typeof pinErrors = {};
      if (!isValidPin(pin)) found.pin = t('onboarding.invalidPin');
      else if (pin !== pinConfirm) found.pinConfirm = t('onboarding.pinMismatch');
      setPinErrors(found);
      if (found.pin || found.pinConfirm) return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (ownerStaffId) {
        ownerPinHash = await hashPin(pin);
        await api.setFirstPin(ownerStaffId, ownerPinHash);
      }
      await registerThisDevice({
        deviceId: deviceId.current,
        shopId: shop.id,
        name: name.trim(),
        mode,
        ...(ownerPinHash && { ownerPinHash }),
        // A new fruit & veg shop picks its products from the built-in list next (US072).
        ...(ownerStaffId &&
          shop.type === 'fruit_veg' && { next: '/products/presets?from=onboarding' }),
      });
      onDone();
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'pin') {
    return (
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <h1 className="text-2xl font-bold">{t('setup.setPinTitle')}</h1>
        <p className="text-muted">{t('setup.setPinIntro')}</p>
        {error && <Alert>{error}</Alert>}
        <Field
          label={t('onboarding.pin')}
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={4}
          dir="ltr"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          error={pinErrors.pin}
          hint={t('onboarding.pinHint')}
          required
        />
        <Field
          label={t('onboarding.pinConfirm')}
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={4}
          dir="ltr"
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value)}
          error={pinErrors.pinConfirm}
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? t('common.wait') : t('setup.savePin')}
        </Button>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="text-2xl font-bold">{t('device.registerTitle')}</h1>
      <p className="text-muted">{t('device.registerIntro', { shop: shop.name })}</p>
      {error && <Alert>{error}</Alert>}
      <DeviceModeField
        value={mode}
        onChange={(next) => {
          if (name === defaultDeviceName(mode, t)) setName(defaultDeviceName(next, t));
          setMode(next);
        }}
      />
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
