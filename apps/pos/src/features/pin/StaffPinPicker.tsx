import type { StaffRow } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PinPad } from './PinPad.tsx';
import { useSwitchableStaff } from './useSwitchableStaff.ts';

interface Props {
  /** Only staff with these roles are offered (and accepted). */
  roles?: readonly string[];
  onSuccess: (staff: StaffRow) => void;
}

/** Pick a person, then type their PIN. With only one candidate the list is skipped. */
export function StaffPinPicker({ roles, onSuccess }: Props) {
  const { t } = useTranslation();
  const staff = useSwitchableStaff(roles);
  const [chosenId, setChosenId] = useState<string | null>(null);
  if (staff === undefined) return null;
  if (staff.length === 0) return <p className="text-muted">{t('pin.nobody')}</p>;

  const chosen = staff.find((s) => s.id === chosenId) ?? (staff.length === 1 ? staff[0] : null);
  if (chosen) {
    return (
      <div className="space-y-3">
        <PinPad
          key={chosen.id}
          staffId={chosen.id}
          staffName={chosen.name}
          {...(roles ? { roles } : {})}
          onSuccess={() => onSuccess(chosen)}
        />
        {staff.length > 1 && (
          <button
            type="button"
            className="min-h-11 w-full rounded-md text-text underline"
            onClick={() => setChosenId(null)}
          >
            {t('pin.someoneElse')}
          </button>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {staff.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => setChosenId(s.id)}
            className="flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-surface px-4 text-start"
          >
            <span className="font-medium">{s.name}</span>
            <span className="text-sm text-muted">{t(`role.${s.role}`)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
