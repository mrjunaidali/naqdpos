import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { getStoredDevice } from '../../db/session.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { ActingOwnerContext } from './actingOwner.ts';
import { StaffPinPicker } from './StaffPinPicker.tsx';

const OWNERS = ['owner'] as const;

/**
 * Owner screens (architecture §4, §5). On an owner device an owner who is switched in goes
 * straight through. On a shop device, or when someone else is switched in, an owner types their
 * PIN every time the screen opens. The acting owner is handed to the screen for its writes.
 */
export function OwnerPinGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const current = useCurrentStaff();
  const mode = useLiveQuery(async () => (await getStoredDevice())?.mode ?? 'shop');
  const [elevated, setElevated] = useState<string | null>(null);
  if (current === undefined || mode === undefined) return null;

  const ownerHere =
    mode === 'owner' && current?.valid && current.staff.role === 'owner' ? current.staff.id : null;
  const acting = elevated ?? ownerHere;
  if (acting) {
    return <ActingOwnerContext.Provider value={acting}>{children}</ActingOwnerContext.Provider>;
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">{t('pin.ownerTitle')}</h1>
      <p className="text-muted">{t('pin.ownerIntro')}</p>
      <StaffPinPicker roles={OWNERS} onSuccess={(owner) => setElevated(owner.id)} />
    </section>
  );
}
