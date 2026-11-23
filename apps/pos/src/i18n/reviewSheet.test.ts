import { parseCsv, toCsv } from '@naqdpos/core';
import { describe, expect, it } from 'vitest';
import {
  applyPresetNames,
  applyReview,
  buildReviewCsv,
  flattenMessages,
  placeholders,
  REVIEW_HEADER,
  type PresetName,
} from './reviewSheet.ts';

const en = {
  home: { welcome: 'Welcome', salesFor: 'Sales for {{date}}' },
  sale: { items_one: '{{count}} item', items_other: '{{count}} items' },
};
const ur = {
  home: { welcome: 'خوش آمدید', salesFor: '{{date}} کی سیل' },
  sale: { items_one: '{{count}} چیز', items_other: '{{count}} اشیاء' },
};
const presets: PresetName[] = [
  { key: 'preset.potato', en: 'Potato', ur: 'آلو' },
  { key: 'presetCategory.vegetables', en: 'Vegetables', ur: 'سبزیاں' },
];

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** The sheet as Junaid returns it: one correction typed into a row. */
function withCorrections(csv: string, corrections: Record<string, string>): string {
  const rows = parseCsv(csv.replace(BOM, ''));
  return toCsv(
    rows.map((r, i) =>
      i > 0 && corrections[r[0]!] !== undefined ? [r[0], r[1], r[2], corrections[r[0]!], r[4]] : r,
    ),
  );
}

describe('review sheet', () => {
  it('has one row per ur.json key plus presets, with a BOM and the agreed columns', () => {
    const csv = buildReviewCsv(en, ur, presets);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsv(csv.slice(1)).filter((r) => r.length > 1);
    expect(rows[0]).toEqual([...REVIEW_HEADER]);
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      'home.welcome',
      'home.salesFor',
      'sale.items_one',
      'sale.items_other',
      'preset.potato',
      'presetCategory.vegetables',
    ]);
    const salesFor = rows.find((r) => r[0] === 'home.salesFor')!;
    expect(salesFor.slice(1, 4)).toEqual(['Sales for {{date}}', '{{date}} کی سیل', '']);
    expect(salesFor[4]).toContain('{{date}}');
    expect(rows.find((r) => r[0] === 'sale.items_one')![4]).toMatch(/plural/i);
  });

  it('applies a correction to ur.json and to a preset name', () => {
    const csv = withCorrections(buildReviewCsv(en, ur, presets), {
      'home.salesFor': '{{date}} کی بکری',
      'preset.potato': 'آلُو',
    });
    const result = applyReview(csv, en, ur, presets);
    expect(result.errors).toEqual([]);
    expect(result.ur).toMatchObject({
      home: { salesFor: '{{date}} کی بکری', welcome: 'خوش آمدید' },
    });
    expect(result.presetUr).toEqual(new Map([['preset.potato', 'آلُو']]));
    expect(result.applied.map((a) => a.key)).toEqual(['home.salesFor', 'preset.potato']);
    // The input object is not changed (the CLI writes only when there are no errors).
    expect(ur.home.salesFor).toBe('{{date}} کی سیل');
  });

  it('refuses the whole import when a placeholder is changed, dropped or added', () => {
    const csv = withCorrections(buildReviewCsv(en, ur, presets), {
      'home.welcome': 'خوش آمدید جی',
      'home.salesFor': '{{tarikh}} کی سیل',
      'sale.items_one': 'ایک چیز',
      'preset.potato': 'آلو {{x}}',
    });
    const result = applyReview(csv, en, ur, presets);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join('\n')).toMatch(/home\.salesFor.*\{\{date\}\}/);
    expect(result.errors.join('\n')).toMatch(/sale\.items_one/);
    expect(result.errors.join('\n')).toMatch(/preset\.potato/);
  });

  it('refuses unknown keys, TODO-ur and a mis-encoded file; ignores blank corrections', () => {
    const base = buildReviewCsv(en, ur, presets);
    expect(applyReview(base, en, ur, presets)).toMatchObject({ errors: [], applied: [] });
    const unknown = base.replace(/\r\n$/, '') + '\r\nhome.nope,x,y,z,\r\n';
    expect(applyReview(unknown, en, ur, presets).errors[0]).toMatch(/home\.nope/);
    const todo = withCorrections(base, { 'home.welcome': 'TODO-ur خوش' });
    expect(applyReview(todo, en, ur, presets).errors[0]).toMatch(/TODO-ur/);
    const spaces = withCorrections(base, { 'home.welcome': '   ' });
    expect(applyReview(spaces, en, ur, presets).applied).toEqual([]);
    // UTF-8 Urdu opened and saved as Windows-1252 (Excel "CSV" instead of "CSV UTF-8").
    const mojibake = withCorrections(base, { 'home.welcome': 'Ø®ÙˆØ´' });
    expect(applyReview(mojibake, en, ur, presets).errors[0]).toMatch(/UTF-8/);
  });

  it('refuses a sheet without the agreed columns', () => {
    expect(applyReview(toCsv([['key', 'urdu']]), en, ur, presets).errors[0]).toMatch(/columns/);
  });

  it('rewrites only the Urdu literal of a preset in freshProduce.ts', () => {
    const source = [
      'export const PRESET_CATEGORIES = {',
      "  vegetables: { en: 'Vegetables', ur: 'سبزیاں', sort: 1 },",
      '};',
      "  veg('potato', 'Potato', 'آلو', 'kg', ['aloo'], { group: 'potato' }),",
      '  veg(',
      "    'green_chilli_small',",
      "    'Green chilli (small)',",
      "    'ہری مرچ',",
      "    'kg',",
      '  ),',
    ].join('\n');
    const out = applyPresetNames(
      source,
      new Map([
        ['preset.potato', 'آلُو'],
        ['preset.green_chilli_small', 'چھوٹی ہری مرچ'],
        ['presetCategory.vegetables', 'سبزی'],
      ]),
    );
    expect(out).toContain("veg('potato', 'Potato', 'آلُو', 'kg'");
    expect(out).toContain("    'چھوٹی ہری مرچ',");
    expect(out).toContain("vegetables: { en: 'Vegetables', ur: 'سبزی', sort: 1 }");
    expect(() => applyPresetNames(source, new Map([['preset.nope', 'x']]))).toThrow(/preset\.nope/);
    expect(() => applyPresetNames(source, new Map([['preset.potato', "it's"]]))).toThrow(/quote/);
  });

  it('flattens nested messages and finds placeholders', () => {
    expect(flattenMessages(en)).toEqual([
      ['home.welcome', 'Welcome'],
      ['home.salesFor', 'Sales for {{date}}'],
      ['sale.items_one', '{{count}} item'],
      ['sale.items_other', '{{count}} items'],
    ]);
    expect(placeholders('{{b}} and {{ a }} and {{b}}')).toEqual(['a', 'b']);
  });
});
