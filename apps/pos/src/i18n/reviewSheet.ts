// The Urdu review sheet (US009): docs/urdu-review.csv lists every Urdu string (ur.json, the
// produce preset names and their categories) for Junaid to correct in Excel. `pnpm
// i18n:import-review <csv>` applies the junaid_correction column back. Pure functions here; the
// CLI in scripts/urdu-review.ts reads and writes the files.
import { decodeCsvText, parseCsv, toCsv } from '@naqdpos/core';

export interface Messages {
  [key: string]: string | Messages;
}

/** A preset name: `preset.<key>` (a produce item) or `presetCategory.<category>`. */
export interface PresetName {
  key: string;
  en: string;
  ur: string;
}

export const REVIEW_HEADER = ['key', 'english', 'urdu', 'junaid_correction', 'note'] as const;

/** Nested messages → [dotted key, text] in file order. */
export function flattenMessages(messages: Messages, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? [[path, value] as [string, string]]
      : flattenMessages(value, path);
  });
}

/** The {{placeholders}} of a text, sorted and without repeats. */
export function placeholders(text: string): string[] {
  const names = [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(names)].sort();
}

/** Context for the reviewer where the English alone is not enough. */
const NOTES: [RegExp, string][] = [
  [
    /^language\.other$/,
    'Button that switches to the OTHER language: in Urdu mode it shows "English".',
  ],
  [/^nav\.(main|side)$/, 'Screen-reader label for the menu (not shown as text).'],
  [
    /^(sale\.rs|receipt\.rs|products\.pricePerUnit)$/,
    'Money format. Digits stay Latin (Rs 1,250).',
  ],
  [/^receipt\./, 'Printed on the paper receipt and in the WhatsApp receipt.'],
  [/^summary\./, 'Day summary: printed and shared on WhatsApp after closing the day.'],
  [/^khata\.whatsappText$/, 'WhatsApp message to the customer after a khata payment.'],
  [/^expense\.cat\./, 'Default expense category name (owners can rename).'],
  [/^payment\.method\./, 'Default payment method name.'],
  [/^unit\./, 'Unit after a quantity, e.g. 1.5 kg.'],
  [/^date\.month\./, 'Month name in dates (23 نومبر 2026). Digits stay Latin.'],
  [/^date\./, 'Date layout; keep the {{placeholders}}.'],
  [/^reports\.preset\.yesterday$/, 'Not "کل": that also means "total" on the same screen.'],
  [/^(pay|done)\.change$/, 'Change to give back to the customer (not khata balance).'],
  [/^expenses?\..*revers/, 'Cancelling an expense entry (a new row that cancels it).'],
  [/^presetCategory\./, 'Default product category, created with the ready-made produce list.'],
  [/^preset\./, 'Ready-made fresh produce list (Settings → Products → Add from list).'],
  [/^foc\.|\.foc$/, 'FOC = given free (e.g. dhania with vegetables).'],
];

export function reviewNote(key: string, english: string): string {
  const notes: string[] = [];
  const match = NOTES.find(([pattern]) => pattern.test(key));
  if (match) notes.push(match[1]);
  if (key.endsWith('_one')) notes.push('Plural form for exactly 1.');
  if (key.endsWith('_other')) notes.push('Plural form for any other number.');
  const names = placeholders(english);
  if (names.length) notes.push(`Keep ${names.map((n) => `{{${n}}}`).join(' ')} exactly.`);
  return notes.join(' ');
}

/** The sheet: UTF-8 with BOM (Excel shows Urdu), CRLF, one row per Urdu string. */
export function buildReviewCsv(en: Messages, ur: Messages, presets: readonly PresetName[]): string {
  const english = new Map(flattenMessages(en));
  const rows: string[][] = [[...REVIEW_HEADER]];
  for (const [key, urdu] of flattenMessages(ur)) {
    const text = english.get(key) ?? '';
    rows.push([key, text, urdu, '', reviewNote(key, text)]);
  }
  for (const p of presets) rows.push([p.key, p.en, p.ur, '', reviewNote(p.key, p.en)]);
  return toCsv(rows);
}

export interface ReviewResult {
  /** ur.json with the corrections (a copy; the input is not changed). */
  ur: Messages;
  /** Preset key → corrected Urdu name. */
  presetUr: Map<string, string>;
  applied: { key: string; from: string; to: string }[];
  /** Any error means nothing may be written. */
  errors: string[];
}

function setPath(messages: Messages, key: string, value: string): void {
  const parts = key.split('.');
  let node = messages;
  for (const part of parts.slice(0, -1)) node = node[part] as Messages;
  node[parts.at(-1)!] = value;
}

/** Reads the returned sheet and checks every non-empty junaid_correction. */
export function applyReview(
  csvText: string,
  en: Messages,
  ur: Messages,
  presets: readonly PresetName[],
): ReviewResult {
  const result: ReviewResult = {
    ur: structuredClone(ur),
    presetUr: new Map(),
    applied: [],
    errors: [],
  };
  const decoded = decodeCsvText(csvText);
  if ('error' in decoded) {
    result.errors.push(
      'The file is not UTF-8. In Excel use Save As → "CSV UTF-8 (Comma delimited)".',
    );
    return result;
  }
  const [header, ...rows] = parseCsv(decoded.text);
  const col = (name: (typeof REVIEW_HEADER)[number]) => header?.indexOf(name) ?? -1;
  const [keyCol, correctionCol] = [col('key'), col('junaid_correction')];
  if (keyCol < 0 || correctionCol < 0) {
    result.errors.push(`The sheet needs the columns ${REVIEW_HEADER.join(', ')}.`);
    return result;
  }

  const english = new Map(flattenMessages(en));
  const urdu = new Map(flattenMessages(ur));
  const presetByKey = new Map(presets.map((p) => [p.key, p]));
  for (const row of rows) {
    const key = row[keyCol]?.trim() ?? '';
    const correction = row[correctionCol]?.trim() ?? '';
    if (!key || !correction) continue;
    const preset = presetByKey.get(key);
    const current = preset ? preset.ur : urdu.get(key);
    const source = preset ? preset.en : english.get(key);
    if (current === undefined || source === undefined) {
      result.errors.push(`${key}: no such key.`);
      continue;
    }
    if (correction.includes('TODO-ur')) {
      result.errors.push(`${key}: remove "TODO-ur" from the correction.`);
      continue;
    }
    const want = placeholders(source);
    const got = placeholders(correction);
    if (want.join() !== got.join()) {
      const list = (names: string[]) => names.map((n) => `{{${n}}}`).join(' ') || 'none';
      result.errors.push(
        `${key}: placeholders must be ${list(want)}, the correction has ${list(got)}.`,
      );
      continue;
    }
    if (correction === current) continue;
    if (preset) result.presetUr.set(key, correction);
    else setPath(result.ur, key, correction);
    result.applied.push({ key, from: current, to: correction });
  }
  return result;
}

const STRING = String.raw`'(?:[^'\\\n]|\\.)*'`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Writes corrected Urdu preset names into the source of packages/core/src/presets/freshProduce.ts:
 * only the Urdu string literal of each named item / category changes.
 */
export function applyPresetNames(source: string, changes: ReadonlyMap<string, string>): string {
  let out = source;
  for (const [key, urdu] of changes) {
    if (/['\\\n]/.test(urdu))
      throw new Error(`${key}: a quote, backslash or line break can't go in a preset name.`);
    const [kind, name] = key.split('.') as [string, string | undefined];
    const pattern =
      kind === 'preset' && name
        ? new RegExp(
            String.raw`(\b(?:veg|green|fruit)\(\s*'${escape(name)}',\s*${STRING},\s*')((?:[^'\\\n]|\\.)*)(')`,
          )
        : kind === 'presetCategory' && name
          ? new RegExp(
              String.raw`(\b${escape(name)}: \{ en: ${STRING}, ur: ')((?:[^'\\\n]|\\.)*)(')`,
            )
          : null;
    if (!pattern || !pattern.test(out)) throw new Error(`${key}: not found in the preset list.`);
    out = out.replace(
      pattern,
      (_m, before: string, _old: string, after: string) => `${before}${urdu}${after}`,
    );
  }
  return out;
}
