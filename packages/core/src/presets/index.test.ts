import { describe, expect, it } from 'vitest';
import { SHOP_TYPES, type ShopType } from '../tenancy.ts';
import { FRESH_PRODUCE, presetsForPicker } from './freshProduce.ts';
import { getPresetsForShopType } from './index.ts';

describe('getPresetsForShopType', () => {
  it('fruit_veg: the fresh produce list, in picker order', () => {
    const list = getPresetsForShopType('fruit_veg');
    expect(list).toEqual(presetsForPicker());
    expect(list).toHaveLength(FRESH_PRODUCE.length);
  });

  it.each(['grocery', 'meat', 'general'] as const)('%s: no list', (type) => {
    expect(getPresetsForShopType(type)).toBeNull();
  });

  it('covers every shop type (a new type must be decided here), and an unknown type gets none', () => {
    const hasList = Object.fromEntries(
      SHOP_TYPES.map((type) => [type, getPresetsForShopType(type) !== null]),
    );
    expect(hasList).toEqual({ fruit_veg: true, grocery: false, meat: false, general: false });
    expect(getPresetsForShopType('bakery' as ShopType)).toBeNull();
  });
});
