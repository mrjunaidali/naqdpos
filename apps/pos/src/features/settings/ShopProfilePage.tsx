import {
  MAX_RECEIPT_FOOTER,
  PAPER_WIDTHS,
  RECEIPT_LANGUAGES,
  validateShopProfile,
  type ShopProfileInput,
  type ShopRow,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { rupeesInput } from '../catalogue/catalogueData.ts';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { saveShopProfile } from './shopProfile.ts';

const ERRORS: Record<string, string> = {
  required: 'shopProfile.errors.required',
  too_long: 'shopProfile.errors.tooLong',
  invalid: 'shopProfile.errors.invalid',
};

/** Settings → Shop (US014, owner): what receipts show. Logo upload comes with object storage. */
export function ShopProfilePage() {
  const shop = useLiveQuery(async () => {
    const device = await getStoredDevice();
    return (device ? await db.shops.get(device.shop_id) : undefined) ?? null;
  });
  if (shop === undefined) return null;
  if (shop === null) return null;
  return <ShopProfileForm shop={shop} />;
}

function ShopProfileForm({ shop }: { shop: ShopRow }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actor = useActingOwnerId();
  const footerId = useId();
  const [values, setValues] = useState<ShopProfileInput>({
    name: shop.name,
    address: shop.address ?? '',
    city: shop.city ?? '',
    phone: shop.phone ?? '',
    receiptFooter: shop.receipt_footer ?? '',
    receiptLanguage: shop.receipt_language ?? 'en',
    paperWidth: shop.paper_width_mm ?? 58,
    expenseLimit: rupeesInput(shop.cashier_expense_limit_paisa),
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateShopProfile>['errors']>({});
  const [failed, setFailed] = useState(false);
  const set =
    (key: 'name' | 'address' | 'city' | 'phone' | 'expenseLimit') =>
    (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value }));
  const errorText = (key: keyof ShopProfileInput) =>
    errors[key] ? t(ERRORS[errors[key]] ?? 'errors.generic') : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateShopProfile(values);
    setErrors(result.errors);
    if (!result.value) return;
    try {
      await saveShopProfile(result.value, actor);
      void navigate('/settings');
    } catch {
      setFailed(true);
    }
  }

  const chip = (pressed: boolean) =>
    `min-h-11 flex-1 rounded-full border px-4 font-medium ${
      pressed ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-text'
    }`;

  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="text-2xl font-bold">{t('shopProfile.title')}</h1>
      {failed && <Alert>{t('errors.generic')}</Alert>}
      <Field
        label={t('shopProfile.name')}
        value={values.name}
        onChange={set('name')}
        error={errorText('name')}
        maxLength={80}
        required
      />
      <Field
        label={t('shopProfile.address')}
        value={values.address}
        onChange={set('address')}
        error={errorText('address')}
        maxLength={200}
      />
      <Field
        label={t('shopProfile.city')}
        value={values.city}
        onChange={set('city')}
        error={errorText('city')}
        maxLength={60}
      />
      <Field
        label={t('shopProfile.phone')}
        value={values.phone}
        onChange={set('phone')}
        error={errorText('phone')}
        inputMode="tel"
        dir="ltr"
      />
      <div className="space-y-1">
        <label htmlFor={footerId} className="block font-medium">
          {t('shopProfile.footer')}
        </label>
        <textarea
          id={footerId}
          rows={3}
          value={values.receiptFooter}
          onChange={(e) => setValues((v) => ({ ...v, receiptFooter: e.target.value }))}
          aria-invalid={errors.receiptFooter ? true : undefined}
          className={`w-full rounded-md border bg-surface px-3 py-2 text-lg ${
            errors.receiptFooter ? 'border-danger' : 'border-border'
          }`}
        />
        <p className={`text-sm ${errors.receiptFooter ? 'text-danger' : 'text-muted'}`}>
          {errorText('receiptFooter') ??
            t('shopProfile.footerCount', {
              count: [...values.receiptFooter].length,
              max: MAX_RECEIPT_FOOTER,
            })}
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">{t('shopProfile.language')}</legend>
        <div className="flex gap-2">
          {RECEIPT_LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={values.receiptLanguage === lang}
              onClick={() => setValues((v) => ({ ...v, receiptLanguage: lang }))}
              className={chip(values.receiptLanguage === lang)}
            >
              {t(`shopProfile.lang.${lang}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-medium">{t('shopProfile.paper')}</legend>
        <div className="flex gap-2">
          {PAPER_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={values.paperWidth === w}
              onClick={() => setValues((v) => ({ ...v, paperWidth: w }))}
              className={chip(values.paperWidth === w)}
            >
              {t('shopProfile.mm', { mm: w })}
            </button>
          ))}
        </div>
      </fieldset>
      <Field
        label={t('shopProfile.expenseLimit')}
        hint={t('shopProfile.expenseLimitHint')}
        value={values.expenseLimit}
        onChange={set('expenseLimit')}
        error={errorText('expenseLimit')}
        inputMode="decimal"
        dir="ltr"
      />
      <p className="text-sm text-muted">{t('shopProfile.logoLater')}</p>
      <Button type="submit">{t('shopProfile.save')}</Button>
    </form>
  );
}
