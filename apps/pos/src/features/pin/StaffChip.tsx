import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getStoredDevice } from '../../db/session.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { staffInitials } from './staffInitials.ts';
import { SwitchStaffDialog } from './SwitchStaffDialog.tsx';

/**
 * Header chip "Ali · A1" (docs/design-theme.md, Screens): who is working on this device; tap to
 * switch with a PIN. When nobody valid is switched in (e.g. the current staff member was
 * deactivated), the switch dialog opens and cannot be closed. Below `sm` it is a round badge with
 * the initials, so the shop name keeps its room at 375px (bug 2026-11-25); the label says who.
 */
export function StaffChip() {
  const { t } = useTranslation();
  const current = useCurrentStaff();
  const code = useLiveQuery(async () => (await getStoredDevice())?.code ?? '');
  const [open, setOpen] = useState(false);
  if (current === undefined) return null;

  if (!current?.valid) return <SwitchStaffDialog />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('pin.switchLabel', { name: current.staff.name })}
        className="inline-flex min-h-11 max-w-40 min-w-11 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium text-text sm:px-3"
      >
        <span aria-hidden="true" className="sm:hidden">
          {staffInitials(current.staff.name)}
        </span>
        <span dir="auto" className="hidden min-w-0 truncate sm:inline">
          {current.staff.name}
          {code ? ` · ${code}` : ''}
        </span>
      </button>
      {open && <SwitchStaffDialog onClose={() => setOpen(false)} />}
    </>
  );
}
