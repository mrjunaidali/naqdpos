import type { StaffRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { canResetByEmail } from './forgotPin.ts';
import { ForgotPinFlow } from './ForgotPinFlow.tsx';
import { PinPad } from './PinPad.tsx';
import { useSwitchableStaff } from './useSwitchableStaff.ts';

interface Props {
  /** Only staff with these roles are offered (and accepted). */
  roles?: readonly string[];
  onSuccess: (staff: StaffRow) => void;
}

/** The signed-in account's own owner staff row in this shop, if it may reset its PIN by email. */
function useResettableOwner(): StaffRow | null | undefined {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return null;
    const staff = await db.staff.where('shop_id').equals(device.shop_id).toArray();
    for (const s of staff) if (await canResetByEmail(s)) return s;
    return null;
  });
}

/**
 * Pick a person, then type their PIN. With only one candidate the list is skipped. The owner
 * linked to the signed-in account also gets "Forgot PIN?" (email code, online), including when
 * their PIN is not on this device at all.
 */
export function StaffPinPicker({ roles, onSuccess }: Props) {
  const { t } = useTranslation();
  const staff = useSwitchableStaff(roles);
  const resettable = useResettableOwner();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [forgot, setForgot] = useState<StaffRow | null>(null);
  if (staff === undefined || resettable === undefined) return null;

  const ownerAllowed = !roles || roles.includes('owner');
  const forgotLink = (owner: StaffRow) => (
    <button
      type="button"
      className="min-h-11 w-full rounded-md text-text underline"
      onClick={() => setForgot(owner)}
    >
      {t('forgotPin.link')}
    </button>
  );

  if (forgot) {
    return (
      <ForgotPinFlow
        staff={forgot}
        onDone={() => onSuccess(forgot)}
        onCancel={() => setForgot(null)}
      />
    );
  }

  if (staff.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-muted">{t('pin.nobody')}</p>
        {resettable && ownerAllowed && forgotLink(resettable)}
      </div>
    );
  }

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
        {resettable?.id === chosen.id && forgotLink(chosen)}
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
