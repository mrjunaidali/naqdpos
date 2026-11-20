import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentStaffStore } from '../../staff/currentStaff.ts';
import { StaffPinPicker } from './StaffPinPicker.tsx';

interface Props {
  /** Absent = cannot be closed (nobody valid is switched in). */
  onClose?: () => void;
}

/** "Switch staff" (US016): choose yourself, type your PIN; checked offline. */
export function SwitchStaffDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const switchTo = useCurrentStaffStore((s) => s.switchTo);

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-text/40 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md space-y-4 rounded-t-2xl bg-surface p-4 sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-lg font-semibold">
            {onClose ? t('pin.switchTitle') : t('pin.whoIsWorking')}
          </h2>
          {onClose && (
            <button type="button" className="min-h-11 min-w-11 rounded-md" onClick={onClose}>
              {t('common.close')}
            </button>
          )}
        </div>
        <StaffPinPicker
          onSuccess={(staff) => {
            void switchTo(staff.id).then(() => onClose?.());
          }}
        />
      </div>
    </div>
  );
}
