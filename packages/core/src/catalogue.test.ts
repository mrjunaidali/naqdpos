import { describe, expect, it } from 'vitest';
import {
  displayName,
  otherName,
  isProductIcon,
  PRODUCT_ICON_CHOICES,
  parseRupees,
  parseSearchTerms,
  PRODUCT_UNITS,
  validateCategoryName,
  validateProductForm,
  type ProductFormInput,
} from './catalogue.ts';
import {
  FRESH_PRODUCE,
  PRESET_CATEGORIES,
  PRESET_ICONS,
  presetsForPicker,
} from './presets/freshProduce.ts';

const valid: ProductFormInput = {
  name: ' Potato ',
  nameUr: 'آلو',
  unit: 'kg',
  categoryId: '',
  salePrice: '80',
  costPrice: '',
  searchTerms: 'aloo, aalu',
  trackStock: false,
};

describe('validateProductForm', () => {
  it('normalises a valid product; rupees become paisa', () => {
    expect(validateProductForm({ ...valid, costPrice: '62.50' })).toEqual({
      errors: {},
      value: {
        name: 'Potato',
        name_ur: 'آلو',
        unit: 'kg',
        category_id: null,
        sale_price_paisa: 8000,
        cost_price_paisa: 6250,
        search_terms: ['aloo', 'aalu'],
        track_stock: false,
        icon: null,
      },
    });
  });

  it('requires a name and a sale price; 0 is a valid price', () => {
    expect(validateProductForm({ ...valid, name: ' ', salePrice: '' }).errors).toEqual({
      name: 'required',
      salePrice: 'required',
    });
    expect(validateProductForm({ ...valid, salePrice: '0' }).value?.sale_price_paisa).toBe(0);
  });

  it('refuses negative or malformed prices', () => {
    expect(validateProductForm({ ...valid, salePrice: '-5' }).errors).toEqual({
      salePrice: 'negative',
    });
    expect(validateProductForm({ ...valid, salePrice: '12.345', costPrice: 'abc' }).errors).toEqual(
      { salePrice: 'invalid', costPrice: 'invalid' },
    );
  });

  it('cost is optional', () => {
    expect(validateProductForm(valid).value?.cost_price_paisa).toBeNull();
  });

  it('checks the unit and the search term limits', () => {
    expect(validateProductForm({ ...valid, unit: 'ton' }).errors).toEqual({ unit: 'invalid_unit' });
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`).join(',');
    expect(validateProductForm({ ...valid, searchTerms: many }).errors).toEqual({
      searchTerms: 'too_many',
    });
    expect(validateProductForm({ ...valid, searchTerms: 'x'.repeat(41) }).errors).toEqual({
      searchTerms: 'too_long',
    });
  });
});

describe('product form: free with purchase (US033)', () => {
  it('builds the rule from rupees and the unit quantity', () => {
    const r = validateProductForm({ ...valid, focOn: true, focMinBill: '200', focQty: '0.05' });
    expect(r.value?.foc_rule).toEqual({ min_bill_paisa: 20000, qty_milli: 50 });
  });

  it('off clears the rule; not shown leaves it unchanged', () => {
    expect(validateProductForm({ ...valid, focOn: false }).value?.foc_rule).toBeNull();
    expect(validateProductForm(valid).value).not.toHaveProperty('foc_rule');
  });

  it('refuses a missing minimum and a bad quantity', () => {
    expect(
      validateProductForm({ ...valid, focOn: true, focMinBill: '', focQty: '0' }).errors,
    ).toEqual({
      focMinBill: 'required',
      focQty: 'invalid_qty',
    });
    expect(
      validateProductForm({
        ...valid,
        unit: 'bundle',
        focOn: true,
        focMinBill: '200',
        focQty: '1.5',
      }).errors,
    ).toEqual({ focQty: 'invalid_qty' });
  });
});

describe('helpers', () => {
  it('parses rupees', () => {
    expect(parseRupees('1,250.75', true)).toEqual({ paisa: 125075 });
    expect(parseRupees('', false)).toEqual({ paisa: null });
  });

  it('splits search terms on commas (also the Urdu comma), dropping blanks and repeats', () => {
    expect(parseSearchTerms('aloo, aalu ,, Aloo،alu')).toEqual(['aloo', 'aalu', 'alu']);
  });

  it('shows the name for the language, falling back to the other', () => {
    expect(displayName({ name: 'Potato', name_ur: 'آلو' }, 'ur')).toBe('آلو');
    expect(displayName({ name: 'Potato', name_ur: null }, 'ur')).toBe('Potato');
    expect(displayName({ name: 'Potato', name_ur: 'آلو' }, 'en')).toBe('Potato');
    expect(displayName({ name: 'Potato', name_ur: '  ' }, 'ur')).toBe('Potato');
  });

  it('gives the other-language name only when it adds something (US009)', () => {
    expect(otherName({ name: 'Potato', name_ur: 'آلو' }, 'ur')).toBe('Potato');
    expect(otherName({ name: 'Potato', name_ur: 'آلو' }, 'en')).toBe('آلو');
    // No Urdu name: Urdu mode already shows "Potato", so nothing under it.
    expect(otherName({ name: 'Potato', name_ur: null }, 'ur')).toBeNull();
    expect(otherName({ name: 'Potato', name_ur: null }, 'en')).toBeNull();
  });

  it('checks category names', () => {
    expect(validateCategoryName('', '')).toEqual({ name: 'required' });
    expect(validateCategoryName('Fruits', 'پھل')).toEqual({});
  });
});

describe('fresh produce presets (docs/features/produce-presets.md)', () => {
  it('has 83 items: 34 vegetables, 9 greens & herbs, 40 fruits', () => {
    const by = (c: string) => FRESH_PRODUCE.filter((p) => p.category === c).length;
    expect(FRESH_PRODUCE).toHaveLength(83);
    expect([by('vegetables'), by('greens'), by('fruits')]).toEqual([34, 9, 40]);
  });

  it('has unique keys and English names, valid units, Urdu names and search spellings', () => {
    expect(new Set(FRESH_PRODUCE.map((p) => p.key)).size).toBe(83);
    expect(new Set(FRESH_PRODUCE.map((p) => p.en.toLowerCase())).size).toBe(83);
    for (const p of FRESH_PRODUCE) {
      expect(PRODUCT_UNITS).toContain(p.unit);
      expect(p.ur.trim()).not.toBe('');
      expect(p.roman.length).toBeGreaterThan(0);
      expect(p.roman.length).toBeLessThanOrEqual(20);
    }
  });

  it('marks the usual FOC items', () => {
    expect(
      FRESH_PRODUCE.filter((p) => p.focDefault)
        .map((p) => p.key)
        .sort(),
    ).toEqual(['coriander', 'curry_leaves', 'green_chilli_small', 'mint']);
  });

  it('orders the picker by category, varieties together, seasonal items later', () => {
    const list = presetsForPicker();
    expect(list.map((p) => p.category).indexOf('greens')).toBeGreaterThan(
      list.map((p) => p.category).lastIndexOf('vegetables'),
    );
    const mangoes = list.flatMap((p, i) => (p.group === 'mango' ? [i] : []));
    expect(mangoes.at(-1)! - mangoes[0]!).toBe(mangoes.length - 1);
    const veg = list.filter((p) => p.category === 'vegetables');
    expect(veg.findIndex((p) => p.seasonal)).toBeGreaterThan(veg.findLastIndex((p) => !p.seasonal));
  });

  it('names the three categories in both languages', () => {
    expect(PRESET_CATEGORIES.greens).toEqual({
      en: 'Greens & herbs',
      ur: 'ساگ اور ہرے مصالحے',
      sort: 2,
    });
  });
});

describe('product icons (US078)', () => {
  it('accepts short emoji, refuses text, digits, spaces and long strings', () => {
    for (const ok of ['🥔', '🌶️', '🫚', '🧑‍🌾', '🥬']) expect(isProductIcon(ok), ok).toBe(true);
    for (const bad of ['potato', 'آلو', '12', '🥔 aloo', ' ', '', '🥔'.repeat(17)]) {
      expect(isProductIcon(bad), bad).toBe(false);
    }
    expect(isProductIcon('🥔'.repeat(16))).toBe(true);
  });

  it('offers about 40 valid food emoji in the picker', () => {
    expect(PRODUCT_ICON_CHOICES.length).toBeGreaterThanOrEqual(40);
    expect(PRODUCT_ICON_CHOICES.every(isProductIcon)).toBe(true);
    expect(new Set(PRODUCT_ICON_CHOICES).size).toBe(PRODUCT_ICON_CHOICES.length);
  });

  it('gives every preset an icon entry: a valid emoji or null', () => {
    expect(Object.keys(PRESET_ICONS).sort()).toEqual(FRESH_PRODUCE.map((p) => p.key).sort());
    for (const p of FRESH_PRODUCE) {
      expect(p.icon === null || isProductIcon(p.icon), p.key).toBe(true);
    }
    expect(FRESH_PRODUCE.find((p) => p.key === 'potato')?.icon).toBe('🥔');
    // Nothing fits: no picture rather than a misleading one.
    for (const key of ['turnip', 'taro_root', 'bitter_gourd', 'falsa', 'jamun', 'loquat']) {
      expect(FRESH_PRODUCE.find((p) => p.key === key)?.icon, key).toBeNull();
    }
  });

  it('the form takes a picture or none, and refuses anything else', () => {
    expect(validateProductForm({ ...valid, icon: '🥔' }).value?.icon).toBe('🥔');
    expect(validateProductForm({ ...valid, icon: null }).value?.icon).toBeNull();
    expect(validateProductForm(valid).value?.icon).toBeNull();
    expect(validateProductForm({ ...valid, icon: 'x' }).errors).toEqual({ icon: 'invalid_icon' });
  });
});
