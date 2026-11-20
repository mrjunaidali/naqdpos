import {
  hashPin,
  isValidPin,
  normalizePkMobile,
  SHOP_TYPES,
  uuidv7,
  type ShopType,
} from '@naqdpos/core';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/index.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { errorMessageKey } from '../../ui/errors.ts';
import { Field } from '../../ui/Field.tsx';
import { DeviceModeField } from './DeviceModeField.tsx';
import { defaultDeviceName, registerThisDevice, type SetupMode } from './setup.ts';

type FieldName = 'shopName' | 'ownerName' | 'mobile' | 'pin' | 'pinConfirm' | 'deviceName';
type Errors = Partial<Record<FieldName, string>>;

/** First sign-in without a shop: create the shop, the owner, and register this device. */
export function OnboardingForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const typeId = useId();
  // Ids are made once, so a retry after a dropped connection repeats the same, idempotent calls.
  const ids = useRef({ shop: uuidv7(), staff: uuidv7(), device: uuidv7() });
  const [values, setValues] = useState({
    shopName: '',
    shopType: 'fruit_veg' as ShopType,
    ownerName: '',
    mobile: '',
    pin: '',
    pinConfirm: '',
    deviceMode: 'shop' as SetupMode,
    deviceName: defaultDeviceName('shop', t),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  function validate(): { errors: Errors; mobile: string | null } {
    const found: Errors = {};
    if (!values.shopName.trim()) found.shopName = t('onboarding.required');
    if (!values.ownerName.trim()) found.ownerName = t('onboarding.required');
    const mobile = normalizePkMobile(values.mobile);
    if (!mobile) found.mobile = t('onboarding.invalidMobile');
    if (!isValidPin(values.pin)) found.pin = t('onboarding.invalidPin');
    else if (values.pin !== values.pinConfirm) found.pinConfirm = t('onboarding.pinMismatch');
    if (!values.deviceName.trim()) found.deviceName = t('onboarding.required');
    return { errors: found, mobile };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { errors: found, mobile } = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || !mobile) return;

    setBusy(true);
    setError(undefined);
    try {
      const ownerPinHash = await hashPin(values.pin);
      await api.createShop({
        shop_id: ids.current.shop,
        name: values.shopName.trim(),
        type: values.shopType,
        // The owner's mobile is also the shop's contact number (architecture §5).
        shop_phone: mobile,
        owner_staff_id: ids.current.staff,
        owner_name: values.ownerName.trim(),
        owner_phone: mobile,
        owner_pin_hash: ownerPinHash,
        device_id: ids.current.device,
      });
      await registerThisDevice({
        deviceId: ids.current.device,
        shopId: ids.current.shop,
        name: values.deviceName.trim(),
        mode: values.deviceMode,
        ownerPinHash,
      });
      onDone();
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="text-2xl font-bold">{t('onboarding.title')}</h1>
      <p className="text-muted">{t('onboarding.intro')}</p>
      {error && <Alert>{error}</Alert>}

      <Field
        label={t('onboarding.shopName')}
        value={values.shopName}
        onChange={set('shopName')}
        error={errors.shopName}
        autoComplete="organization"
        required
      />
      <div className="space-y-1">
        <label htmlFor={typeId} className="block font-medium">
          {t('onboarding.shopType')}
        </label>
        <select
          id={typeId}
          value={values.shopType}
          onChange={set('shopType')}
          className="min-h-12 w-full rounded-md border border-border bg-surface px-3 text-lg"
        >
          {SHOP_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`shopType.${type}`)}
            </option>
          ))}
        </select>
      </div>
      <Field
        label={t('onboarding.ownerName')}
        value={values.ownerName}
        onChange={set('ownerName')}
        error={errors.ownerName}
        autoComplete="name"
        required
      />
      <Field
        label={t('onboarding.mobile')}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        dir="ltr"
        placeholder="0300 1234567"
        value={values.mobile}
        onChange={set('mobile')}
        error={errors.mobile}
        hint={t('onboarding.mobileHint')}
        required
      />
      <Field
        label={t('onboarding.pin')}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={4}
        dir="ltr"
        value={values.pin}
        onChange={set('pin')}
        error={errors.pin}
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
        value={values.pinConfirm}
        onChange={set('pinConfirm')}
        error={errors.pinConfirm}
        required
      />
      <DeviceModeField
        value={values.deviceMode}
        onChange={(mode) =>
          setValues((v) => ({
            ...v,
            deviceMode: mode,
            deviceName:
              v.deviceName === defaultDeviceName(v.deviceMode, t)
                ? defaultDeviceName(mode, t)
                : v.deviceName,
          }))
        }
      />
      <Field
        label={t('device.name')}
        value={values.deviceName}
        onChange={set('deviceName')}
        error={errors.deviceName}
        hint={t('device.nameHint')}
        required
      />
      <Button type="submit" disabled={busy}>
        {busy ? t('common.wait') : t('onboarding.submit')}
      </Button>
    </form>
  );
}
