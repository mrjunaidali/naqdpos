import { isProductUnit, qtyLabel, rupeesText, type UnitCode } from '@naqdpos/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/**
 * "kg", "ml", "ملی لیٹر": the unit's word in the UI language. A unit from a newer app version
 * (synced to an older device, architecture §4) shows as its code instead of a missing key.
 */
export function unitName(t: TFunction, unit: UnitCode): string {
  return isProductUnit(unit) ? t(`unit.${unit}`) : unit;
}

/**
 * "Rs 214.50", "Rs 1,250": grouped Latin digits in both languages (US009). Paisa are kept;
 * input fields use `rupeesInput` (no separators) instead.
 */
export function useRs() {
  const { t } = useTranslation();
  return (paisa: number) => t('sale.rs', { amount: rupeesText(paisa) });
}

/** "250 g", "1.5 kg", "½ dozen", "6 piece" in the UI language. */
export function useQtyText() {
  const { t } = useTranslation();
  return (qtyMilli: number, unit: UnitCode) => {
    const label = qtyLabel(qtyMilli, unit);
    return t('sale.qty', { amount: label.amount, unit: unitName(t, label.unit) });
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
