// Ready-made product lists per shop type (docs/features/produce-presets.md). Only fruit & veg
// shops have one today; grocery, meat and general shops get none until their lists are written,
// so they never see fresh produce they don't sell. CSV import and manual add work for every type.
import { SHOP_TYPES, type ShopType } from '../tenancy.ts';
import { presetsForPicker, type ProducePreset } from './freshProduce.ts';

/** A shop type's presets, in picker order. */
export type PresetList = readonly ProducePreset[];

const FRESH_PRODUCE_LIST: PresetList = presetsForPicker();

const LISTS: Record<ShopType, PresetList | null> = {
  fruit_veg: FRESH_PRODUCE_LIST,
  grocery: null,
  meat: null,
  general: null,
};

/** The ready-made list for a shop type, or null when there is none (also for an unknown type). */
export function getPresetsForShopType(type: ShopType): PresetList | null {
  return (SHOP_TYPES as readonly string[]).includes(type) ? LISTS[type] : null;
}
