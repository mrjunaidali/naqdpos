// Shop profile (US014): what the owner edits in Settings → Shop and what receipts show.
import { parseRupees } from './catalogue.ts';
import {
  PAPER_WIDTHS,
  RECEIPT_LANGUAGES,
  type PaperWidth,
  type ReceiptLanguage,
} from './tenancy.ts';

export const MAX_SHOP_NAME = 80;
export const MAX_SHOP_ADDRESS = 200;
export const MAX_RECEIPT_FOOTER = 200;

export interface ShopProfileInput {
  name: string;
  address: string;
  /** Optional (also used by self-registration). */
  city?: string;
  phone: string;
  receiptFooter: string;
  receiptLanguage: string;
  paperWidth: number;
  /** Cashier expense limit in rupees (US046); owners have none. */
  expenseLimit: string;
}

export interface ShopProfileValue {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  receipt_footer: string | null;
  receipt_language: ReceiptLanguage;
  paper_width_mm: PaperWidth;
  cashier_expense_limit_paisa: number;
}

export type ShopProfileError = 'required' | 'too_long' | 'invalid';

/** Any Pakistani number people print on a receipt (mobile or landline), digits and + - space. */
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{5,18}[0-9]$/;

const chars = (s: string) => [...s].length;

export function validateShopProfile(input: ShopProfileInput): {
  errors: Partial<Record<keyof ShopProfileInput, ShopProfileError>>;
  value?: ShopProfileValue;
} {
  const errors: Partial<Record<keyof ShopProfileInput, ShopProfileError>> = {};
  const name = input.name.trim();
  if (!name) errors.name = 'required';
  else if (chars(name) > MAX_SHOP_NAME) errors.name = 'too_long';
  const address = input.address.trim();
  if (chars(address) > MAX_SHOP_ADDRESS) errors.address = 'too_long';
  const city = (input.city ?? '').trim();
  if (chars(city) > 60) errors.city = 'too_long';
  const phone = input.phone.trim();
  if (phone && !PHONE_PATTERN.test(phone)) errors.phone = 'invalid';
  // Lines kept as typed (trailing spaces trimmed); the limit counts every character.
  const footer = input.receiptFooter
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
  if (chars(footer) > MAX_RECEIPT_FOOTER) errors.receiptFooter = 'too_long';
  const language = (RECEIPT_LANGUAGES as readonly string[]).includes(input.receiptLanguage)
    ? (input.receiptLanguage as ReceiptLanguage)
    : null;
  if (!language) errors.receiptLanguage = 'invalid';
  const width = (PAPER_WIDTHS as readonly number[]).includes(input.paperWidth)
    ? (input.paperWidth as PaperWidth)
    : null;
  if (!width) errors.paperWidth = 'invalid';
  const limit = parseRupees(input.expenseLimit, true);
  if (limit.error) errors.expenseLimit = limit.error === 'required' ? 'required' : 'invalid';

  if (Object.keys(errors).length > 0 || !language || !width || limit.paisa === null) {
    return { errors };
  }
  return {
    errors,
    value: {
      name,
      address: address || null,
      city: city || null,
      phone: phone || null,
      receipt_footer: footer || null,
      receipt_language: language,
      paper_width_mm: width,
      cashier_expense_limit_paisa: limit.paisa,
    },
  };
}
