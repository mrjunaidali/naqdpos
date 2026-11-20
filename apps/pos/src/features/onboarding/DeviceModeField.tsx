import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { SetupMode } from './setup.ts';

const OPTIONS: { mode: SetupMode; label: string; hint: string }[] = [
  { mode: 'owner', label: 'device.modeOwner', hint: 'device.modeOwnerHint' },
  { mode: 'shop', label: 'device.modeShop', hint: 'device.modeShopHint' },
];

/**
 * "Who uses this device?" (architecture §4 device modes). Defaults to the shop counter, so
 * owner-only data (salaries, later cost prices) reaches a device only when the owner says so.
 */
export function DeviceModeField({
  value,
  onChange,
}: {
  value: SetupMode;
  onChange: (mode: SetupMode) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t('device.modeQuestion')}</legend>
      {OPTIONS.map((option) => (
        <label
          key={option.mode}
          className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-md border p-3 ${
            value === option.mode ? 'border-primary' : 'border-border'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={option.mode}
            checked={value === option.mode}
            onChange={() => onChange(option.mode)}
            className="mt-1 size-5 accent-primary"
          />
          <span>
            <span className="block font-medium">{t(option.label)}</span>
            <span className="block text-sm text-muted">{t(option.hint)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
