// The ml unit (25 Nov 2026) and units this app version doesn't know (architecture §4).
import { describe, expect, it } from 'vitest';
import { ProductRowSchema, SaleLineRowSchema } from './api/schemas.ts';
import { makeLine, parseQtyInput, qtyLabel, unitRule, UNIT_RULES, type CartLine } from './cart.ts';
import { isProductUnit, PRODUCT_UNITS, validateProductForm } from './catalogue.ts';
import { suggestedFocRule } from './discount.ts';
import { previewImport } from './productImport.ts';
import { priceForQty } from './qty.ts';

const source = (unit: string) => ({
  product_id: 'p-rose',
  name: 'Rose water',
  name_ur: null,
  unit,
  icon: null,
  unit_price_paisa: 5000, // Rs 50 per ml
});

describe('ml unit', () => {
  it('is a product unit', () => {
    expect(PRODUCT_UNITS).toContain('ml');
    expect(isProductUnit('ml')).toBe(true);
  });

  it('6 ml × Rs 50 = Rs 300 (qty_milli = ml × 1000)', () => {
    expect(priceForQty(6000, 5000)).toBe(30000);
    const line = makeLine(source('ml'), 6000) as CartLine;
    expect(line).toMatchObject({ unit: 'ml', qty_milli: 6000, line_total_paisa: 30000 });
  });

  it('whole millilitres only, like g; no quick buttons, no "by amount"', () => {
    expect(UNIT_RULES.ml).toEqual(UNIT_RULES.g);
    expect(parseQtyInput('6', 'ml')).toEqual({ qty_milli: 6000 });
    expect(parseQtyInput('6.5', 'ml')).toEqual({ error: 'too_many_decimals' });
    expect(parseQtyInput('0.5', 'ml')).toEqual({ error: 'too_many_decimals' });
  });

  it('labels as "6 ml"; a free-with-purchase rule suggests 50 ml', () => {
    expect(qtyLabel(6000, 'ml')).toEqual({ amount: '6', unit: 'ml' });
    expect(qtyLabel(250_000, 'ml')).toEqual({ amount: '250', unit: 'ml' });
    expect(suggestedFocRule('ml').qty_milli).toBe(50_000);
  });

  it('the product form, CSV import and synced rows accept ml', () => {
    const form = validateProductForm({
      name: 'Rose water',
      nameUr: '',
      unit: 'ml',
      categoryId: '',
      salePrice: '50',
      costPrice: '',
      searchTerms: '',
    } as Parameters<typeof validateProductForm>[0]);
    expect('errors' in form ? form.errors.unit : undefined).toBeUndefined();
    const csv = previewImport(
      [
        ['name', 'name_ur', 'unit', 'category', 'sale_price', 'cost_price', 'search_terms'],
        ['Rose water', '', 'ml', '', '50', '', ''],
        ['Kewra water', '', 'ML', '', '40', '', ''],
      ],
      [],
    );
    expect(csv.rows.map((r) => r.errors)).toEqual([[], []]);
  });
});

describe('a unit this app version does not know', () => {
  it('synced rows still parse (the device keeps the product and the sale line)', () => {
    const product = {
      id: '019a9b8e-0000-7000-8000-000000000101',
      shop_id: '019a9b8e-0000-7000-8000-00000000000b',
      category_id: null,
      name: 'Rice',
      name_ur: null,
      unit: 'maund',
      sale_price_paisa: 100,
      barcode: null,
      track_stock: false,
      min_qty_milli: null,
      is_combo: false,
      packaging_cost_paisa: 0,
      foc_rule: null,
      search_terms: [],
      icon: null,
      device_id: null,
      created_at: '2026-11-25T10:00:00.000Z',
      updated_at: '2026-11-25T10:00:00.000Z',
      deleted_at: null,
      server_seq: 1,
    };
    expect(ProductRowSchema.safeParse(product).success).toBe(true);
    expect(ProductRowSchema.safeParse({ ...product, unit: '' }).success).toBe(false);
    expect(SaleLineRowSchema.shape.unit_snapshot.safeParse('maund').success).toBe(true);
  });

  it('can not be created: the form refuses it', () => {
    expect(isProductUnit('maund')).toBe(false);
    const form = validateProductForm({
      name: 'Rice',
      nameUr: '',
      unit: 'maund',
      categoryId: '',
      salePrice: '1',
      costPrice: '',
      searchTerms: '',
    } as Parameters<typeof validateProductForm>[0]);
    expect('errors' in form ? form.errors.unit : undefined).toBe('invalid_unit');
  });

  it('gets safe entry rules and shows its raw code (label and receipt)', () => {
    expect(unitRule('maund')).toEqual({ decimals: 3, byAmount: false, quick: [] });
    expect(parseQtyInput('1.25', 'maund')).toEqual({ qty_milli: 1250 });
    expect(qtyLabel(2000, 'maund')).toEqual({ amount: '2', unit: 'maund' });
    expect(unitRule('ml')).toBe(UNIT_RULES.ml);
  });
});
