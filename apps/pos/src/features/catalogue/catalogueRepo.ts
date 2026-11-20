// Catalogue writes (US019–US021, US072): every change goes through localWriteMany (Dexie + outbox,
// one transaction, offline) with the acting owner as actor_staff_id. A sale price change always
// writes a price_history row; a cost change (owner devices only) writes product_costs and a
// product_cost_history row.
import {
  PRESET_CATEGORIES,
  uuidv7,
  type CategoryRow,
  type Paisa,
  type PresetCategory,
  type ProducePreset,
  type ProductFormValue,
  type ProductRow,
} from '@naqdpos/core';
import { localWriteMany, type LocalWrite } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

interface Context {
  shopId: string;
  deviceId: string;
  now: string;
}

async function context(): Promise<Context> {
  const device = await getStoredDevice();
  if (!device) throw new Error('This device is not set up');
  return { shopId: device.shop_id, deviceId: device.id, now: new Date().toISOString() };
}

/** Owner devices are the only ones that hold and push costs (pull_scope owner_device). */
export async function costsOnThisDevice(): Promise<boolean> {
  return (await getStoredDevice())?.mode === 'owner';
}

const write = (table: LocalWrite['table'], row: object, op: LocalWrite['op'] = 'upsert') => ({
  table,
  op,
  row: { ...row } as Record<string, unknown>,
});

function priceRow(c: Context, productId: string, paisa: Paisa) {
  return write(
    'price_history',
    {
      id: uuidv7(),
      shop_id: c.shopId,
      product_id: productId,
      sale_price_paisa: paisa,
      effective_at: c.now,
      created_at: c.now,
      device_id: c.deviceId,
      server_seq: null,
    },
    'insert',
  );
}

async function costRows(c: Context, productId: string, paisa: Paisa): Promise<LocalWrite[]> {
  const current = await db.product_costs.get(productId);
  if (current && current.cost_price_paisa === paisa && current.deleted_at === null) return [];
  return [
    write('product_costs', {
      product_id: productId,
      shop_id: c.shopId,
      cost_price_paisa: paisa,
      created_at: current?.created_at ?? c.now,
      updated_at: c.now,
      deleted_at: null,
      device_id: c.deviceId,
      server_seq: current?.server_seq ?? null,
    }),
    write(
      'product_cost_history',
      {
        id: uuidv7(),
        shop_id: c.shopId,
        product_id: productId,
        cost_price_paisa: paisa,
        effective_at: c.now,
        created_at: c.now,
        device_id: c.deviceId,
        server_seq: null,
      },
      'insert',
    ),
  ];
}

function newProduct(c: Context, fields: Partial<ProductRow> & Pick<ProductRow, 'name' | 'unit'>) {
  const row: ProductRow = {
    id: uuidv7(),
    shop_id: c.shopId,
    category_id: null,
    name_ur: null,
    sale_price_paisa: 0,
    barcode: null,
    track_stock: false,
    min_qty_milli: null,
    is_combo: false,
    packaging_cost_paisa: 0,
    foc_rule: null,
    search_terms: [],
    icon: null,
    created_at: c.now,
    updated_at: c.now,
    deleted_at: null,
    device_id: c.deviceId,
    server_seq: null,
    ...fields,
  };
  return row;
}

/** Add (existing = null) or edit a product. `withCost` only on owner devices. */
export async function saveProduct(
  existing: ProductRow | null,
  value: ProductFormValue,
  actorStaffId: string,
  withCost: boolean,
): Promise<string> {
  const c = await context();
  const fields = {
    name: value.name,
    name_ur: value.name_ur,
    unit: value.unit,
    category_id: value.category_id,
    sale_price_paisa: value.sale_price_paisa,
    search_terms: value.search_terms,
    track_stock: value.track_stock,
    icon: value.icon,
  };
  const product: ProductRow = existing
    ? { ...existing, ...fields, updated_at: c.now }
    : newProduct(c, fields);
  const writes: LocalWrite[] = [write('products', product)];
  const priceChanged = existing
    ? existing.sale_price_paisa !== value.sale_price_paisa
    : value.sale_price_paisa > 0;
  if (priceChanged) writes.push(priceRow(c, product.id, value.sale_price_paisa));
  if (withCost && value.cost_price_paisa !== null) {
    writes.push(...(await costRows(c, product.id, value.cost_price_paisa)));
  }
  await localWriteMany(writes, db, { actorStaffId });
  return product.id;
}

/** Quick price edit from the list. */
export async function setSalePrice(product: ProductRow, paisa: Paisa, actorStaffId: string) {
  if (product.sale_price_paisa === paisa) return;
  const c = await context();
  await localWriteMany(
    [
      write('products', { ...product, sale_price_paisa: paisa, updated_at: c.now }),
      priceRow(c, product.id, paisa),
    ],
    db,
    { actorStaffId },
  );
}

/** Hide (soft delete) or show again. */
export async function setProductHidden(product: ProductRow, hidden: boolean, actorStaffId: string) {
  const c = await context();
  await localWriteMany(
    [write('products', { ...product, deleted_at: hidden ? c.now : null, updated_at: c.now })],
    db,
    { actorStaffId },
  );
}

// --- Categories ---

export async function shopCategories(): Promise<CategoryRow[]> {
  const device = await getStoredDevice();
  if (!device) return [];
  const rows = await db.categories.where('shop_id').equals(device.shop_id).toArray();
  return rows
    .filter((r) => r.deleted_at === null)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export async function saveCategory(
  existing: CategoryRow | null,
  names: { name: string; name_ur: string | null },
  actorStaffId: string,
): Promise<string> {
  const c = await context();
  const all = await shopCategories();
  const row: CategoryRow = existing
    ? { ...existing, ...names, updated_at: c.now }
    : {
        id: uuidv7(),
        shop_id: c.shopId,
        ...names,
        sort: Math.max(0, ...all.map((x) => x.sort)) + 1,
        created_at: c.now,
        updated_at: c.now,
        deleted_at: null,
        device_id: c.deviceId,
        server_seq: null,
      };
  await localWriteMany([write('categories', row)], db, { actorStaffId });
  return row.id;
}

/** Moves a category one place up or down; renumbers 1…n so ties never block a move. */
export async function moveCategory(id: string, direction: -1 | 1, actorStaffId: string) {
  const c = await context();
  const list = await shopCategories();
  const from = list.findIndex((x) => x.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return;
  const reordered = [...list];
  [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
  const writes = reordered.flatMap((cat, i) =>
    cat.sort === i + 1 ? [] : [write('categories', { ...cat, sort: i + 1, updated_at: c.now })],
  );
  if (writes.length) await localWriteMany(writes, db, { actorStaffId });
}

// --- Presets (US072) ---

export type PresetStatus = 'new' | 'added' | 'hidden';

/** Products of this shop by English name, lower-cased (the spec's duplicate rule). */
export async function productsByName(): Promise<Map<string, ProductRow>> {
  const device = await getStoredDevice();
  const rows = device ? await db.products.where('shop_id').equals(device.shop_id).toArray() : [];
  const map = new Map<string, ProductRow>();
  // An active product wins over a hidden one with the same name.
  for (const row of rows.sort(
    (a, b) => Number(a.deleted_at === null) - Number(b.deleted_at === null),
  )) {
    map.set(row.name.trim().toLowerCase(), row);
  }
  return map;
}

export function presetStatus(preset: ProducePreset, byName: Map<string, ProductRow>): PresetStatus {
  const existing = byName.get(preset.en.toLowerCase());
  if (!existing) return 'new';
  return existing.deleted_at === null ? 'added' : 'hidden';
}

export interface PresetChoice {
  preset: ProducePreset;
  /** Today's rate; null = blank (price 0, asked at the first sale). */
  rate: Paisa | null;
}

export interface PresetResult {
  created: number;
  restored: number;
  skipped: number;
}

/**
 * Creates the ticked presets in ONE transaction: the categories they need (matched by English
 * name, created on demand), one product each (name, name_ur, unit, search_terms) and a
 * price_history row when a rate was given. A preset matching an active product is skipped; one
 * matching a hidden product restores it (and applies the new rate) instead of duplicating it.
 */
export async function createFromPresets(
  choices: readonly PresetChoice[],
  actorStaffId: string,
): Promise<PresetResult> {
  const c = await context();
  const byName = await productsByName();
  const categories = await shopCategories();
  const categoryIds = new Map<PresetCategory, string>();
  const writes: LocalWrite[] = [];
  const result: PresetResult = { created: 0, restored: 0, skipped: 0 };
  let nextSort = Math.max(0, ...categories.map((x) => x.sort)) + 1;

  const categoryFor = (key: PresetCategory): string => {
    const known = categoryIds.get(key);
    if (known) return known;
    const names = PRESET_CATEGORIES[key];
    const found = categories.find((x) => x.name.trim().toLowerCase() === names.en.toLowerCase());
    if (found) {
      categoryIds.set(key, found.id);
      return found.id;
    }
    const id = uuidv7();
    writes.push(
      write('categories', {
        id,
        shop_id: c.shopId,
        name: names.en,
        name_ur: names.ur,
        sort: nextSort++,
        created_at: c.now,
        updated_at: c.now,
        deleted_at: null,
        device_id: c.deviceId,
        server_seq: null,
      }),
    );
    categoryIds.set(key, id);
    return id;
  };

  for (const { preset, rate } of choices) {
    const existing = byName.get(preset.en.toLowerCase());
    if (existing && existing.deleted_at === null) {
      result.skipped += 1;
      continue;
    }
    if (existing) {
      const price = rate ?? existing.sale_price_paisa;
      writes.push(
        write('products', {
          ...existing,
          deleted_at: null,
          sale_price_paisa: price,
          // Keep a picture the owner already chose; otherwise take the preset's.
          icon: existing.icon ?? preset.icon,
          updated_at: c.now,
        }),
      );
      if (rate !== null && rate !== existing.sale_price_paisa) {
        writes.push(priceRow(c, existing.id, rate));
      }
      byName.set(preset.en.toLowerCase(), { ...existing, deleted_at: null });
      result.restored += 1;
      continue;
    }
    const product = newProduct(c, {
      name: preset.en,
      name_ur: preset.ur,
      unit: preset.unit,
      category_id: categoryFor(preset.category),
      sale_price_paisa: rate ?? 0,
      search_terms: [...preset.roman],
      icon: preset.icon,
    });
    writes.push(write('products', product));
    if (rate !== null) writes.push(priceRow(c, product.id, rate));
    byName.set(preset.en.toLowerCase(), product);
    result.created += 1;
  }

  if (writes.length) await localWriteMany(writes, db, { actorStaffId });
  return result;
}

// --- Today's rates (US020) ---

export interface RateChange {
  product: ProductRow;
  sale: Paisa;
  /** null = unchanged / not on this device. */
  cost: Paisa | null;
}

/** "Save all": every changed price (and cost on owner devices) in one transaction. */
export async function saveTodaysRates(
  changes: readonly RateChange[],
  actorStaffId: string,
  withCost: boolean,
): Promise<number> {
  const c = await context();
  const writes: LocalWrite[] = [];
  let changed = 0;
  for (const { product, sale, cost } of changes) {
    const before = writes.length;
    if (sale !== product.sale_price_paisa) {
      writes.push(write('products', { ...product, sale_price_paisa: sale, updated_at: c.now }));
      writes.push(priceRow(c, product.id, sale));
    }
    if (withCost && cost !== null) writes.push(...(await costRows(c, product.id, cost)));
    if (writes.length > before) changed += 1;
  }
  if (writes.length) await localWriteMany(writes, db, { actorStaffId });
  return changed;
}
