import { parseRupees, type CustomerRow, type StaffRow } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { KhataNotSaved, recordOpeningBalance } from './khataRepo.ts';

/** Opening balance from the paper khata (US080, owner): the amount the customer already owes. */
export function OpeningBalanceSheet(props: {
  customer: CustomerRow;
  owner: StaffRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string>();

  async function save() {
    const parsed = parseRupees(amount, true);
    if (parsed.error || !parsed.paisa) return setError(t('khata.errors.amount'));
    try {
      await recordOpeningBalance(props.customer, parsed.paisa, props.owner);
      props.onClose();
    } catch (e) {
      setError(t(`khata.errors.${e instanceof KhataNotSaved ? e.reason : 'amount'}`));
    }
  }

  return (
    <Sheet title={t('khata.openingTitle')} onClose={props.onClose}>
      <p className="text-muted">{t('customers.openingBalanceHint')}</p>
      <Field
        label={t('khata.amount')}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setError(undefined);
        }}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        error={error}
      />
      <Button onClick={() => void save()}>{t('khata.saveOpening')}</Button>
    </Sheet>
  );
}
