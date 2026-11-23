// Product import for the admin portal (US013): CSV (from Excel, "CSV UTF-8") and the fresh
// produce list. Pure: parse, validate, preview; the server writes (admin_import_products).
import { parseRupees, PRODUCT_UNITS, type ProductUnit } from './catalogue.ts';
import { PRESET_CATEGORIES, type ProducePreset } from './presets/freshProduce.ts';
import type { Paisa } from './money.ts';

/** RFC 4180-style: quoted fields, "" inside quotes, commas and line breaks in quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type CsvDecodeError = 'bad_encoding';

const CP1252_HIGH =
  '\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC' +
  '\u2013\u2014\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122';
const MOJIBAKE_ARABIC = new RegExp(`[\u00D8-\u00DB][${CP1252_HIGH}]`);

/**
 * Text from an uploaded CSV: strips a UTF-8 BOM. Refuses text that was not read as UTF-8 (the
 * replacement character, or typical Windows-1252 mojibake of Arabic script) so the admin saves it
 * as "CSV UTF-8" instead of importing garbled Urdu.
 */
export function decodeCsvText(text: string): { text: string } | { error: CsvDecodeError } {
  const clean = text.replace(/^\uFEFF/, '');
  // U+FFFD, or UTF-8 Arabic-script bytes (D8–DB then 80–BF) read as Windows-1252 / Latin-1:
  // Ø Ù Ú Û followed by what 1252 shows for 0x80–0xBF.
  if (clean.includes('\uFFFD') || MOJIBAKE_ARABIC.test(clean)) {
    return { error: 'bad_encoding' };
  }
  return { text: clean };
}

export const IMPORT_COLUMNS = [
  'name',
  'name_ur',
  'unit',
  'category',
  'sale_price',
  'cost_price',
  'search_terms',
] as const;

export interface ImportRow {
  name: string;
  name_ur: string | null;
  unit: ProductUnit;
  category: string | null;
  category_ur?: string | null;
  sale_price_paisa: Paisa;
  cost_price_paisa?: Paisa;
  search_terms: string[];
  icon?: string | null;
}

export type ImportRowError =
  | 'name_required'
  | 'name_too_long'
  | 'bad_unit'
  | 'bad_sale_price'
  | 'bad_cost_price'
  | 'duplicate_in_file'
  | 'too_many_terms';

export interface PreviewRow {
  line: number;
  row?: ImportRow;
  errors: ImportRowError[];
  /** A product with this English name already exists (skip or update). */
  exists: boolean;
}

export interface ImportPreview {
  rows: PreviewRow[];
  /** Header problems: a required column is missing. */
  missingColumns: string[];
  valid: ImportRow[];
  errorCount: number;
  existingCount: number;
}

/** Validates CSV rows (first row = header) against the shop's existing English names. */
export function previewImport(table: string[][], existingNames: Iterable<string>): ImportPreview {
  const existing = new Set([...existingNames].map((n) => n.trim().toLowerCase()));
  const [header = [], ...body] = table;
  const index = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const missingColumns = ['name', 'unit', 'sale_price'].filter((c) => !index.has(c));
  const cell = (r: string[], c: string) => (index.has(c) ? (r[index.get(c)!] ?? '').trim() : '');
  const seen = new Set<string>();
  const rows: PreviewRow[] = body.map((r, i) => {
    const errors: ImportRowError[] = [];
    const name = cell(r, 'name');
    if (!name) errors.push('name_required');
    else if ([...name].length > 100) errors.push('name_too_long');
    const unitText = cell(r, 'unit').toLowerCase();
    const unit = (PRODUCT_UNITS as readonly string[]).includes(unitText)
      ? (unitText as ProductUnit)
      : null;
    if (!unit) errors.push('bad_unit');
    const sale = parseRupees(cell(r, 'sale_price') || '0', true);
    if (sale.error) errors.push('bad_sale_price');
    const costText = cell(r, 'cost_price');
    const cost = costText ? parseRupees(costText, true) : null;
    if (cost?.error) errors.push('bad_cost_price');
    const terms = cell(r, 'search_terms')
      .split(/[;,|]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length > 20) errors.push('too_many_terms');
    const key = name.toLowerCase();
    if (name && seen.has(key)) errors.push('duplicate_in_file');
    if (name) seen.add(key);
    const base = { line: i + 2, errors, exists: !!name && existing.has(key) };
    if (errors.length || !unit || sale.paisa === null) return base;
    const row: ImportRow = {
      name,
      name_ur: cell(r, 'name_ur') || null,
      unit,
      category: cell(r, 'category') || null,
      sale_price_paisa: sale.paisa,
      search_terms: terms,
    };
    if (cost?.paisa != null) row.cost_price_paisa = cost.paisa;
    return { ...base, row };
  });
  const valid = rows.flatMap((r) => (r.row ? [r.row] : []));
  return {
    rows,
    missingColumns,
    valid: missingColumns.length ? [] : valid,
    errorCount: rows.filter((r) => r.errors.length).length,
    existingCount: rows.filter((r) => r.row && r.exists).length,
  };
}

/** Fresh produce picks as import rows (the same names, Urdu, units, categories and icons). */
export function presetImportRows(
  choices: readonly { preset: ProducePreset; rate: Paisa | null }[],
): ImportRow[] {
  return choices.map(({ preset, rate }) => ({
    name: preset.en,
    name_ur: preset.ur,
    unit: preset.unit,
    category: PRESET_CATEGORIES[preset.category].en,
    category_ur: PRESET_CATEGORIES[preset.category].ur,
    sale_price_paisa: rate ?? 0,
    search_terms: [...preset.roman],
    icon: preset.icon,
  }));
}

/** The WhatsApp text for a new shop's owner (no email provider yet). */
export function inviteMessage(shopName: string, appUrl: string, email: string): string {
  return `Assalam o alaikum! Your shop ${shopName} is ready on NaqdPOS. Open ${appUrl} and sign in with ${email}.`;
}

/** wa.me link that opens WhatsApp with the text for that mobile (E.164; digits only in the link). */
export function whatsAppLink(mobileE164: string, text: string): string {
  return `https://wa.me/${mobileE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
