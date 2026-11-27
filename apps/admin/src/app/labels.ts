import type { ShopType } from '@naqdpos/core';

export const SHOP_TYPE_LABELS: Record<ShopType, string> = {
  fruit_veg: 'Fruit & veg',
  grocery: 'Grocery',
  meat: 'Meat',
  general: 'General',
};

/** The shop app address in the invite text comes only from settings (VITE_POS_URL). */
export const posUrl = () => import.meta.env.VITE_POS_URL?.trim() ?? '';

/** Invite email language (docs/emails.md). */
export const EMAIL_LANGUAGE_OPTIONS = [
  ['en', 'English'],
  ['ur', 'Urdu (اردو)'],
] as const;
