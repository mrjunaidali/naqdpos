import { describe, expect, it } from 'vitest';
import {
  displayName,
  parseRupees,
  parseSearchTerms,
  PRODUCT_UNITS,
  validateCategoryName,
  validateProductForm,
  type ProductFormInput,
} from './catalogue.ts';
import { FRESH_PRODUCE, PRESET_CATEGORIES, presetsForPicker } from './presets/freshProduce.ts';

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
