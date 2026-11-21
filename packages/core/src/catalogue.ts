// Catalogue rows and rules (architecture §3, US019–US021, US072). Money is integer paisa,
// entered in rupees (rupeesToPaisa); never floats.
import { rupeesToPaisa, type Paisa } from './money.ts';
import { parseQtyInput } from './cart.ts';
import { MAX_FOC_QTY_MILLI, type FocRule } from './discount.ts';

export const PRODUCT_UNITS = ['kg', 'g', 'dozen', 'piece', 'bundle', 'litre'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Max characters (code points) of products.icon, as Postgres char_length counts them. */
export const MAX_ICON_LENGTH = 16;

// Same rule as product_icon_ok() in migration 20261121180000: emoji blocks, variation selectors,
// zero-width joiner, keycap; no letters, digits or spaces. Checked per code point (a regex
// character class holding joiners and selectors is easy to misread).
const ICON_JOINERS = new Set([0xfe0e, 0xfe0f, 0x200d, 0x20e3]);
function isIconCodePoint(cp: number): boolean {
  return (cp >= 0x2190 && cp <= 0x2bff) || (cp >= 0x1f000 && cp <= 0x1faff) || ICON_JOINERS.has(cp);
}

/** A short emoji-like string allowed as a product picture. */
export function isProductIcon(value: string): boolean {
  const points = [...value].map((ch) => ch.codePointAt(0)!);
  return points.length >= 1 && points.length <= MAX_ICON_LENGTH && points.every(isIconCodePoint);
}

/** The Picture field's choices (US078): common food emoji. */
export const PRODUCT_ICON_CHOICES = [
  '🥔',
  '🧅',
  '🍅',
  '🧄',
  '🫚',
  '🌶️',
  '🍋',
  '🥒',
  '🥕',
  '🥬',
  '🥦',
  '🍆',
  '🫛',
  '🫑',
  '🍠',
  '🌽',
  '🌿',
  '🍄',
  '🥜',
  '🫘',
  '🍌',
  '🍎',
  '🍏',
  '🥭',
  '🍊',
  '🍈',
  '🍉',
  '🍐',
  '🍑',
  '🍒',
  '🍓',
  '🫐',
  '🥝',
  '🥥',
  '🍍',
  '🍇',
  '🥚',
  '🍞',
  '🍚',
  '🥛',
  '🧀',
  '🍗',
  '🥩',
  '🐟',
  '🧂',
  '🫙',
] as const;

/** search_terms limits (products.search_terms check in the migration). */
export const MAX_SEARCH_TERMS = 20;
export const MAX_SEARCH_TERM_LENGTH = 40;

interface Synced {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
  server_seq: number | null;
}

export interface CategoryRow extends Synced {
  id: string;
  shop_id: string;
  name: string;
  name_ur: string | null;
  sort: number;
}

export interface ProductRow extends Synced {
  id: string;
  shop_id: string;
  category_id: string | null;
  name: string;
  name_ur: string | null;
  unit: ProductUnit;
  sale_price_paisa: Paisa;
  barcode: string | null;
  track_stock: boolean;
  min_qty_milli: number | null;
  is_combo: boolean;
  packaging_cost_paisa: Paisa;
  /** Free with purchase (US033): offered as a one-tap suggestion, never added automatically. */
  foc_rule: FocRule | null;
  /** Other names and Roman Urdu spellings (aloo, aalu…), for search. */
  search_terms: string[];
  /** One emoji shown on the tile (US078); absent in rows from before it existed. */
  icon?: string | null | undefined;
}

/** Owner-only current cost; only owner devices hold it. */
export interface ProductCostRow extends Synced {
  product_id: string;
  shop_id: string;
  cost_price_paisa: Paisa;
}

/** Append-only: one row per sale price change. */
export interface PriceHistoryRow {
  id: string;
  shop_id: string;
  product_id: string;
  sale_price_paisa: Paisa;
  effective_at: string;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

/** Append-only, owner-only: one row per cost change. */
export interface ProductCostHistoryRow {
  id: string;
  shop_id: string;
  product_id: string;
  cost_price_paisa: Paisa;
  effective_at: string;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

/** The name for the UI language, falling back to the other one (architecture §3). */
export function displayName(row: { name: string; name_ur: string | null }, language: string) {
  if (language === 'ur') return row.name_ur?.trim() || row.name;
  return row.name.trim() || row.name_ur || '';
}

/** "aloo, aalu ,, Aaloo" → ['aloo', 'aalu', 'Aaloo']: trimmed, no blanks or repeats. */
export function parseSearchTerms(input: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of input.split(/[,،\n]/)) {
    const term = raw.trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
  }
  return terms;
}

export type PriceError = 'required' | 'invalid' | 'negative';

/** Rupees typed by the user → paisa. Blank is an error only when `required`. */
export function parseRupees(
  input: string,
  required: boolean,
): { paisa: Paisa | null; error?: PriceError } {
  const text = input.trim();
  if (!text) return required ? { paisa: null, error: 'required' } : { paisa: null };
  if (text.startsWith('-')) return { paisa: null, error: 'negative' };
  try {
    return { paisa: rupeesToPaisa(text) };
  } catch {
    return { paisa: null, error: 'invalid' };
  }
}

export interface ProductFormInput {
  name: string;
  nameUr: string;
  unit: string;
  categoryId: string;
  salePrice: string;
  /** Only shown to owners on owner devices; blank = no cost. */
  costPrice: string;
  searchTerms: string;
  trackStock: boolean;
  /** Picture (emoji) or null for none. */
  icon?: string | null;
  /** "Free with purchase" (US033): on, minimum bill in rupees, quantity in the product's unit. */
  focOn?: boolean;
  focMinBill?: string;
  focQty?: string;
}

export type ProductFormError =
  | 'required'
  | 'too_long'
  | 'invalid_unit'
  | PriceError
  | 'too_many'
  | 'invalid_icon'
  | 'invalid_qty'
  | 'too_large';

export interface ProductFormValue {
  name: string;
  name_ur: string | null;
  unit: ProductUnit;
  category_id: string | null;
  sale_price_paisa: Paisa;
  cost_price_paisa: Paisa | null;
  search_terms: string[];
  track_stock: boolean;
  icon: string | null;
  /** undefined = leave the product's rule as it is. */
  foc_rule?: FocRule | null | undefined;
}

export interface ProductFormResult {
  errors: Partial<
    Record<
      | 'name'
      | 'nameUr'
      | 'unit'
      | 'salePrice'
      | 'costPrice'
      | 'searchTerms'
      | 'icon'
      | 'focMinBill'
      | 'focQty',
      ProductFormError
    >
  >;
  value?: ProductFormValue;
}

export function validateProductForm(input: ProductFormInput): ProductFormResult {
  const errors: ProductFormResult['errors'] = {};
  const name = input.name.trim();
  if (!name) errors.name = 'required';
  else if (name.length > 100) errors.name = 'too_long';
  const nameUr = input.nameUr.trim();
  if (nameUr.length > 100) errors.nameUr = 'too_long';

  const unit = (PRODUCT_UNITS as readonly string[]).includes(input.unit)
    ? (input.unit as ProductUnit)
    : null;
  if (!unit) errors.unit = 'invalid_unit';

  const sale = parseRupees(input.salePrice, true);
  if (sale.error) errors.salePrice = sale.error;
  const cost = parseRupees(input.costPrice, false);
  if (cost.error) errors.costPrice = cost.error;

  const terms = parseSearchTerms(input.searchTerms);
  if (terms.length > MAX_SEARCH_TERMS) errors.searchTerms = 'too_many';
  else if (terms.some((t) => t.length > MAX_SEARCH_TERM_LENGTH)) errors.searchTerms = 'too_long';

  const icon = input.icon ?? null;
  if (icon !== null && !isProductIcon(icon)) errors.icon = 'invalid_icon';

  let focRule: FocRule | null | undefined;
  if (input.focOn === false) focRule = null;
  else if (input.focOn && unit) {
    const min = parseRupees(input.focMinBill ?? '', true);
    if (min.error) errors.focMinBill = min.error;
    const qty = parseQtyInput(input.focQty ?? '', unit);
    if ('error' in qty) errors.focQty = qty.error === 'too_large' ? 'too_large' : 'invalid_qty';
    else if (qty.qty_milli > MAX_FOC_QTY_MILLI) errors.focQty = 'too_large';
    if (min.paisa !== null && 'qty_milli' in qty && !errors.focQty) {
      focRule = { min_bill_paisa: min.paisa, qty_milli: qty.qty_milli };
    }
  }

  if (Object.keys(errors).length > 0 || !unit || sale.paisa === null) return { errors };
  return {
    errors,
    value: {
      name,
      name_ur: nameUr || null,
      unit,
      category_id: input.categoryId || null,
      sale_price_paisa: sale.paisa,
      cost_price_paisa: cost.paisa,
      search_terms: terms,
      track_stock: input.trackStock,
      icon,
      ...(focRule !== undefined && { foc_rule: focRule }),
    },
  };
}

/** Category name check (create and rename). */
export function validateCategoryName(name: string, nameUr: string) {
  const errors: Partial<Record<'name' | 'nameUr', 'required' | 'too_long'>> = {};
  if (!name.trim()) errors.name = 'required';
  else if (name.trim().length > 60) errors.name = 'too_long';
  if (nameUr.trim().length > 60) errors.nameUr = 'too_long';
  return errors;
}
