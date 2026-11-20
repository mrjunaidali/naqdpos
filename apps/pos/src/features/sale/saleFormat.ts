import { qtyLabel, type ProductUnit } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';
import { rupeesInput } from '../catalogue/catalogueData.ts';

/** "Rs 214.50", "Rs 240" (paisa kept: bill rounding is decided with the payment story). */
export function useRs() {
  const { t } = useTranslation();
  return (paisa: number) => t('sale.rs', { amount: rupeesInput(paisa) });
}

/** "250 g", "1.5 kg", "½ dozen", "6 piece" in the UI language. */
export function useQtyText() {
  const { t } = useTranslation();
  return (qtyMilli: number, unit: ProductUnit) => {
    const label = qtyLabel(qtyMilli, unit);
    return t('sale.qty', { amount: label.amount, unit: t(`unit.${label.unit}`) });
  };
}

/** What the keypad shows for a quantity: units (grams for `g` products). */
export function qtyToKeypad(qtyMilli: number): string {
  const whole = Math.trunc(qtyMilli / 1000);
  const frac = String(qtyMilli % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}
