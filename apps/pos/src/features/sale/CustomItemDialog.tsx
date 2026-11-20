import {
  isLineError,
  makeLine,
  parseQtyInput,
  parseRupees,
  PRODUCT_UNITS,
  type CartLine,
} from '@naqdpos/core';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { rupeesInput } from '../catalogue/catalogueData.ts';
import { useCartStore } from './cartStore.ts';
import { qtyToKeypad } from './saleFormat.ts';

/**
 * "Custom item" (US030): something not in the list, so a sale is never blocked. The line has no
 * product (product_id null) and is flagged as custom.
 */
export function CustomItemDialog(props: { existing?: CartLine | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const put = useCartStore((s) => s.put);
  const unitId = useId();
  const e = props.existing;
  const [values, setValues] = useState({
    name: e?.name ?? '',
    price: e ? rupeesInput(e.unit_price_paisa) : '',
    qty: e ? qtyToKeypad(e.qty_milli) : '1',
    unit: e?.unit ?? 'piece',
  });
  const [errors, setErrors] = useState<Partial<Record<'name' | 'price' | 'qty', string>>>({});

  const set = (name: keyof typeof values) => (ev: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: ev.target.value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    const name = values.name.trim();
    if (!name) found.name = t('products.errors.required');
    else if (name.length > 100) found.name = t('products.errors.tooLong');
    const price = parseRupees(values.price, true);
    if (price.error === 'negative') found.price = t('products.errors.negative');
    else if (price.error || !price.paisa) found.price = t('sale.errors.price');
    const qty = parseQtyInput(values.qty, values.unit);
    if ('error' in qty)
      found.qty = t(
        qty.error === 'too_many_decimals'
          ? 'sale.errors.decimals'
          : qty.error === 'too_large'
            ? 'sale.errors.tooLarge'
            : 'sale.errors.qty',
      );
    setErrors(found);
    if (Object.keys(found).length || 'error' in qty || !price.paisa) return;
    const line = makeLine(
      {
        product_id: null,
        is_custom: true,
        name,
        name_ur: null,
        unit: values.unit,
        icon: null,
        unit_price_paisa: price.paisa,
      },
      qty.qty_milli,
      e?.id,
    );
    if (isLineError(line)) {
      setErrors({ qty: t('sale.errors.qty') });
      return;
    }
    put(line);
    props.onClose();
  }

  return (
    <Sheet title={t('sale.customTitle')} onClose={props.onClose}>
      <form className="space-y-3" onSubmit={submit} noValidate>
        <Field
          label={t('sale.customName')}
          value={values.name}
          onChange={set('name')}
          error={errors.name}
          autoComplete="off"
        />
        <Field
          label={t('sale.customPrice')}
          inputMode="decimal"
          dir="ltr"
          value={values.price}
          onChange={set('price')}
          error={errors.price}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('sale.customQty')}
            inputMode="decimal"
            dir="ltr"
            value={values.qty}
            onChange={set('qty')}
            error={errors.qty}
          />
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
        </div>
        <Button type="submit">{e ? t('sale.update') : t('sale.add')}</Button>
      </form>
    </Sheet>
  );
}
