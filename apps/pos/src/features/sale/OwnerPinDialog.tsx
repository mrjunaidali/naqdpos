import { useTranslation } from 'react-i18next';
import { Sheet } from '../../ui/Sheet.tsx';
import { StaffPinPicker } from '../pin/StaffPinPicker.tsx';

const OWNERS = ['owner'] as const;

/** Asks an owner for their PIN for one action (same rules as OwnerPinGate). */
export function OwnerPinDialog(props: {
  onSuccess: (ownerId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet title={t('pin.ownerTitle')} onClose={props.onClose}>
      <p className="text-muted">{t('sale.ownerPinForRate')}</p>
      <StaffPinPicker roles={OWNERS} onSuccess={(owner) => props.onSuccess(owner.id)} />
    </Sheet>
  );
}
