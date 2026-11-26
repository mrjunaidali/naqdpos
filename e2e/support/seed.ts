// Seeding the shop app's IndexedDB for e2e tests: the app opens once so Dexie creates its schema,
// then rows are written straight into the stores (no API needed).
import type { Page } from '@playwright/test';

export const SHOP = '01900000-0000-7000-8000-000000000201';
export const OWNER = '01900000-0000-7000-8000-000000000202';
export const DEVICE = '01900000-0000-7000-8000-000000000203';

const now = () => new Date().toISOString();
export const mutable = () => ({
  created_at: now(),
  updated_at: now(),
  deleted_at: null,
  server_seq: 1,
});

/** A signed-in owner on an owner-mode device, with one shop and its owner. */
export function ownerDevice(shopName = 'E2E Fruits') {
  return {
    meta: [
      {
        key: 'session',
        value: { token: 't', user_id: 'u', email: 'o@e2e.test', checked_at: now() },
      },
      {
        key: 'device',
        value: { id: DEVICE, code: 'A1', shop_id: SHOP, mode: 'owner', staff_id: OWNER },
      },
      { key: 'current_staff', value: { staff_id: OWNER, switched_at: now() } },
    ],
    shops: [
      {
        ...mutable(),
        id: SHOP,
        name: shopName,
        type: 'fruit_veg',
        address: null,
        phone: null,
        receipt_footer: null,
        logo_path: null,
        status: 'active',
        plan_id: null,
        timezone: 'Asia/Karachi',
        cashier_expense_limit_paisa: 200_000,
        cashier_max_discount_pct: 10,
        receipt_language: 'en',
        paper_width_mm: 58,
        device_id: null,
      },
    ],
    staff: [
      {
        ...mutable(),
        id: OWNER,
        shop_id: SHOP,
        name: 'Owner',
        phone: null,
        role: 'owner',
        pin_hash: null,
        membership_user_id: 'u',
        active: true,
        device_id: null,
      },
    ],
  };
}

export function product(over: {
  id: string;
  name: string;
  name_ur: string | null;
  unit: string;
  sale_price_paisa: number;
  icon: string | null;
  sort?: number;
}) {
  return {
    ...mutable(),
    shop_id: SHOP,
    category_id: null,
    barcode: null,
    track_stock: false,
    min_qty_milli: null,
    is_combo: false,
    packaging_cost_paisa: 0,
    foc_rule: null,
    search_terms: [],
    device_id: null,
    ...over,
  };
}

/** Writes rows into the app's IndexedDB (created by Dexie on the first load). */
export async function writeRows(page: Page, rows: Record<string, unknown[]>): Promise<void> {
  await page.evaluate(
    (rows) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('naqdpos');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const idb = open.result;
          const tx = idb.transaction(Object.keys(rows), 'readwrite');
          for (const [store, list] of Object.entries(rows))
            for (const row of list) tx.objectStore(store).put(row);
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(new Error(String(tx.error)));
        };
      }),
    rows,
  );
}
