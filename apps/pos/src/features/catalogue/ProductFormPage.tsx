import {
  displayName,
  PRODUCT_UNITS,
  suggestedFocRule,
  validateProductForm,
  type Paisa,
  type ProductFormResult,
  type ProductRow,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { db } from '../../db/schema.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { rupeesInput, useCategories, useCostsHere } from './catalogueData.ts';
import { saveProduct, setProductHidden } from './catalogueRepo.ts';
import { qtyToKeypad } from '../sale/saleFormat.ts';
import { ProductStockLine } from '../stock/ProductStockLine.tsx';
import { IconPicker } from './IconPicker.tsx';

/** /products/new and /products/:productId (owner screen, US019). */
export function ProductFormPage() {
  const { productId } = useParams();
  const loaded = useLiveQuery(async () => {
    if (!productId) return { product: null, cost: null };
    const [product, cost] = await Promise.all([
      db.products.get(productId),
      db.product_costs.get(productId),
    ]);
    return { product: product ?? null, cost: cost?.cost_price_paisa ?? null };
  }, [productId]);
  const costsHere = useCostsHere();
  if (loaded === undefined || costsHere === undefined) return null;
  return (
    <ProductForm
      key={loaded.product?.id ?? 'new'}
      existing={loaded.product}
      cost={loaded.cost}
      costsHere={costsHere}
    />
  );
}

const ERROR_KEYS: Record<string, string> = {
  required: 'products.errors.required',
  too_long: 'products.errors.tooLong',
  invalid_unit: 'products.errors.unit',
  invalid: 'products.errors.price',
  negative: 'products.errors.negative',
  too_many: 'products.errors.tooManyTerms',
  invalid_qty: 'products.errors.focQty',
  too_large: 'sale.errors.tooLarge',
};

function ProductForm(props: {
  existing: ProductRow | null;
  cost: Paisa | null;
  costsHere: boolean;
}) {
  const { existing, costsHere } = props;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const actor = useActingOwnerId();
  const categories = useCategories() ?? [];
  const unitId = useId();
  const categoryId = useId();
  const [values, setValues] = useState({
    name: existing?.name ?? '',
    nameUr: existing?.name_ur ?? '',
    unit: existing?.unit ?? 'kg',
    categoryId: existing?.category_id ?? '',
    salePrice: existing ? rupeesInput(existing.sale_price_paisa) : '',
    costPrice: rupeesInput(props.cost),
    searchTerms: existing?.search_terms.join(', ') ?? '',
    trackStock: existing?.track_stock ?? false,
    icon: existing?.icon ?? null,
    // Free with purchase (US033): off unless the product has a rule; on fills a suggestion.
    focOn: existing?.foc_rule != null,
    focMinBill: existing?.foc_rule ? rupeesInput(existing.foc_rule.min_bill_paisa) : '',
    focQty: existing?.foc_rule ? qtyToKeypad(existing.foc_rule.qty_milli) : '',
  });
  const [errors, setErrors] = useState<ProductFormResult['errors']>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const errorText = (field: keyof ProductFormResult['errors']) => {
    const code = errors[field];
    return code ? t(ERROR_KEYS[code] ?? 'errors.generic') : undefined;
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      void navigate('/products');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // Cost is never read or written where costs don't live (shop devices).
    const result = validateProductForm({ ...values, costPrice: costsHere ? values.costPrice : '' });
    setErrors(result.errors);
    const value = result.value;
    if (value) void run(() => saveProduct(existing, value, actor, costsHere));
  }

  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={submit} noValidate>
      <h1 className="text-2xl font-bold">
        {existing ? t('products.editTitle') : t('products.addTitle')}
      </h1>
      {failed && <Alert>{t('errors.generic')}</Alert>}
      {existing?.deleted_at && <Alert tone="info">{t('products.hiddenNotice')}</Alert>}
      <Field
        label={t('products.name')}
        value={values.name}
        onChange={set('name')}
        error={errorText('name')}
        autoComplete="off"
        required
      />
      <Field
        label={t('products.nameUr')}
        value={values.nameUr}
        onChange={set('nameUr')}
        error={errorText('nameUr')}
        dir="rtl"
        lang="ur"
        autoComplete="off"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={unitId} className="block font-medium">
            {t('products.unit')}
          </label>
          <select
            id={unitId}
            value={values.unit}
            onChange={set('unit')}
            className="min-h-12 w-full rounded-md border border-border bg-surface px-3 text-lg"
          >
            {PRODUCT_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`unit.${u}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={categoryId} className="block font-medium">
            {t('products.category')}
          </label>
          <select
            id={categoryId}
            value={values.categoryId}
            onChange={set('categoryId')}
            className="min-h-12 w-full rounded-md border border-border bg-surface px-3 text-lg"
          >
            <option value="">{t('products.noCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c, i18n.language)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Field
        label={t('products.salePrice')}
        inputMode="decimal"
        dir="ltr"
        value={values.salePrice}
        onChange={set('salePrice')}
        error={errorText('salePrice')}
        hint={t('products.salePriceHint', { unit: t(`unit.${values.unit}`) })}
        required
      />
      {costsHere ? (
        <Field
          label={t('products.costPrice')}
          inputMode="decimal"
          dir="ltr"
          value={values.costPrice}
          onChange={set('costPrice')}
          error={errorText('costPrice')}
          hint={t('products.costPriceHint')}
        />
      ) : (
        <p className="text-sm text-muted">{t('products.costElsewhere')}</p>
      )}
      <Field
        label={t('products.searchTerms')}
        value={values.searchTerms}
        onChange={set('searchTerms')}
        error={errorText('searchTerms')}
        hint={t('products.searchTermsHint')}
        autoComplete="off"
      />
      <IconPicker value={values.icon} onChange={(icon) => setValues((v) => ({ ...v, icon }))} />
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={values.trackStock}
          onChange={(e) => setValues((v) => ({ ...v, trackStock: e.target.checked }))}
          className="size-5 accent-primary"
        />
        {t('products.trackStock')}
      </label>
      {existing && values.trackStock && <ProductStockLine product={existing} />}
      <fieldset className="space-y-3 rounded-xl border border-border p-3">
        <legend className="px-1 font-medium">{t('foc.section')}</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={values.focOn}
            onChange={(e) => {
              const on = e.target.checked;
              setValues((v) => {
                if (!on || v.focMinBill || v.focQty) return { ...v, focOn: on };
                const rule = suggestedFocRule(v.unit);
                return {
                  ...v,
                  focOn: true,
                  focMinBill: rupeesInput(rule.min_bill_paisa),
                  focQty: qtyToKeypad(rule.qty_milli),
                };
              });
            }}
            className="size-5 accent-primary"
          />
          {t('foc.offer')}
        </label>
        {values.focOn && (
          <>
            <Field
              label={t('foc.minBill')}
              value={values.focMinBill}
              onChange={set('focMinBill')}
              error={errorText('focMinBill')}
              inputMode="decimal"
              dir="ltr"
            />
            <Field
              label={t('foc.qty', { unit: t(`unit.${values.unit}`) })}
              value={values.focQty}
              onChange={set('focQty')}
              error={errorText('focQty')}
              inputMode="decimal"
              dir="ltr"
            />
          </>
        )}
      </fieldset>
      <Button type="submit" disabled={busy}>
        {busy ? t('common.wait') : t('products.save')}
      </Button>
      {existing && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(() => setProductHidden(existing, existing.deleted_at === null, actor))
          }
        >
          {existing.deleted_at === null ? t('products.hide') : t('products.show')}
        </Button>
      )}
    </form>
  );
}
