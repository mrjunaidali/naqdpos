import { DEFAULT_CASHIER_MAX_DISCOUNT_PCT } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { saveDiscountLimit } from './discountLimit.ts';

/**
 * Settings → Cashier discount limit (US032): a cashier's give-away per bill (line discounts +
 * bill discount + free items) up to this % of the paid lines' price. Above it the owner's PIN.
 */
export function DiscountLimitPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actor = useActingOwnerId();
  const current = useLiveQuery(async () => {
    const device = await getStoredDevice();
    const shop = device ? await db.shops.get(device.shop_id) : undefined;
    return shop?.cashier_max_discount_pct ?? DEFAULT_CASHIER_MAX_DISCOUNT_PCT;
  });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState(false);
  if (current === undefined) return null;
  const value = text ?? String(current);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{1,3}$/.test(value.trim()) || Number(value) > 100) {
      setError(t('discountLimit.invalid'));
      return;
    }
    try {
      await saveDiscountLimit(Number(value), actor);
      void navigate('/settings');
    } catch {
      setFailed(true);
    }
  }

  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="text-2xl font-bold">{t('discountLimit.title')}</h1>
      <p className="text-muted">{t('discountLimit.intro')}</p>
      {failed && <Alert>{t('errors.generic')}</Alert>}
      <Field
        label={t('discountLimit.label')}
        value={value}
        onChange={(e) => {
          setText(e.target.value);
          setError(undefined);
        }}
        error={error}
        inputMode="numeric"
        dir="ltr"
        maxLength={3}
      />
      <Button type="submit">{t('discountLimit.save')}</Button>
    </form>
  );
}
