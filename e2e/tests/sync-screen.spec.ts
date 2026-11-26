// Sync screen with a rejected entry at 375px, English and Urdu (bug 2026-11-25, "Staging rejects a
// product change"). The app opens once so Dexie creates its schema; the test then writes a signed-in
// device and one rejected `ml` product straight into IndexedDB. The API is stubbed: pull lists the
// server's units, push rejects the product again with field `unit` (so "Try again" ends back in
// "Needs review"). Screenshots land in test-results/screenshots/.
import { expect, test, type Page, type Route } from '@playwright/test';
import { API_ORIGIN, siteUrl } from '../support/sites.ts';

const SHOP = '01900000-0000-7000-8000-000000000101';
const OWNER = '01900000-0000-7000-8000-000000000102';
const CASHIER = '01900000-0000-7000-8000-000000000103';
const DEVICE = '01900000-0000-7000-8000-000000000104';
const PRODUCT = '01900000-0000-7000-8000-000000000105';
const ENTRY = '01900000-0000-7000-8001-000000000106';
const SHOP_NAME = 'Mian Sami Fruit & Vegetable Shop';

// No service worker: in WebKit a worker-controlled page's API calls bypass page.route, so the
// stub would not answer (Chromium routes them either way). Offline start is the smoke test's job.
test.use({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });

function seed(staffId: string) {
  const now = new Date().toISOString();
  const mutable = { created_at: now, updated_at: now, deleted_at: null, server_seq: 1 };
  const staff = (id: string, name: string, role: string) => ({
    ...mutable,
    id,
    shop_id: SHOP,
    name,
    phone: null,
    role,
    pin_hash: null,
    membership_user_id: role === 'owner' ? 'u' : null,
    active: true,
    device_id: null,
  });
  const productRow = {
    ...mutable,
    server_seq: null,
    id: PRODUCT,
    shop_id: SHOP,
    category_id: null,
    name: 'Rose water',
    name_ur: 'عرقِ گلاب',
    unit: 'ml',
    sale_price_paisa: 5000,
    barcode: null,
    track_stock: false,
    min_qty_milli: null,
    is_combo: false,
    packaging_cost_paisa: 0,
    foc_rule: null,
    search_terms: [],
    icon: null,
    device_id: DEVICE,
  };
  return {
    meta: [
      { key: 'session', value: { token: 't', user_id: 'u', email: 'o@e2e.test', checked_at: now } },
      {
        key: 'device',
        value: {
          id: DEVICE,
          code: 'A1',
          shop_id: SHOP,
          mode: staffId === OWNER ? 'owner' : 'shop',
          staff_id: OWNER,
        },
      },
      { key: 'current_staff', value: { staff_id: staffId, switched_at: now } },
    ],
    shops: [
      {
        ...mutable,
        id: SHOP,
        name: SHOP_NAME,
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
    staff: [staff(OWNER, 'Mian Sami', 'owner'), staff(CASHIER, 'Bilal', 'cashier')],
    products: [productRow],
    sync_errors: [
      {
        id: ENTRY,
        table: 'products',
        op: 'upsert',
        row: productRow,
        row_key: `products:${PRODUCT}`,
        created_at: now,
        attempts: 1,
        actor_staff_id: OWNER,
        code: 'invalid',
        message: 'unit: Invalid option',
        field: 'unit',
        rejected_at: now,
      },
    ],
  };
}

async function writeRows(page: Page, rows: Record<string, unknown[]>) {
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

/** The API stub: counts pushes and rejects every pushed entry again, naming the field. */
async function stubApi(page: Page) {
  const calls = { push: 0 };
  const cors = {
    'access-control-allow-origin': siteUrl('pos'),
    // Listed: `*` does not cover Authorization.
    'access-control-allow-headers':
      'authorization, content-type, accept, x-device-id, x-app-version',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json',
  };
  await page.route(`${API_ORIGIN}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(request.url()).pathname;
    if (path === '/sync/pull') {
      return route.fulfill({
        headers: cors,
        body: JSON.stringify({
          rows: [],
          next_seq: 0,
          has_more: false,
          units: ['kg', 'g', 'dozen', 'piece', 'bundle', 'litre', 'ml'],
        }),
      });
    }
    if (path === '/sync/push') {
      calls.push += 1;
      const body = request.postDataJSON() as { entries: { id: string }[] };
      return route.fulfill({
        headers: cors,
        body: JSON.stringify({
          accepted: [],
          conflicts: [],
          errors: body.entries.map((e) => ({ id: e.id, code: 'invalid', field: 'unit' })),
        }),
      });
    }
    return route.abort('internetdisconnected');
  });
  return calls;
}

async function openSync(page: Page, staffId: string, language: 'en' | 'ur') {
  const calls = await stubApi(page);
  await page.goto(siteUrl('pos'));
  await page.evaluate((lng) => localStorage.setItem('naqdpos.language', lng), language);
  await writeRows(page, seed(staffId));
  await page.goto(`${siteUrl('pos')}/sync`);
  return calls;
}

/** The shop name in the header ends in an ellipsis and keeps several characters visible. */
async function expectHeaderNameTruncates(page: Page) {
  const name = page.locator('header').getByText(SHOP_NAME);
  await expect(name).toBeVisible();
  const box = await name.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      width: el.getBoundingClientRect().width,
      fontSize: parseFloat(style.fontSize),
      overflow: style.textOverflow,
      clipped: el.scrollWidth > el.clientWidth,
    };
  });
  expect(box.overflow).toBe('ellipsis');
  expect(box.clipped).toBe(true);
  // At least ~4 characters wide: never collapsed to a single letter next to the mark.
  expect(box.width).toBeGreaterThanOrEqual(box.fontSize * 4);
}

const screenshot = (page: Page, browserName: string, name: string) =>
  page.screenshot({ path: `test-results/screenshots/sync-${browserName}-${name}.png` });

test('owner: one rejected ml product, named with its field; Try again rejects it again (en)', async ({
  page,
  browserName,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = await openSync(page, OWNER, 'en');

  const status = page.getByRole('status').filter({ hasText: 'was not accepted' });
  await expect(status).toHaveText(/1 change was not accepted/);
  await expect(status).toHaveAttribute('data-tone', 'warning');
  await expect(page.getByText('Everything is synced.')).toHaveCount(0);
  const entry = page.getByTestId('rejected-entry');
  await expect(entry).toContainText('Rose water');
  await expect(entry).toContainText('Products');
  await expect(entry).toContainText('Unit was not accepted.');
  await expect(page.getByText(/sync\.table\./)).toHaveCount(0);
  await expectHeaderNameTruncates(page);
  await screenshot(page, browserName, 'en');

  const before = calls.push;
  await page.getByRole('button', { name: 'Try again: Rose water' }).click();
  await expect.poll(() => calls.push).toBeGreaterThan(before);
  await expect(page.getByTestId('rejected-entry')).toContainText('Unit was not accepted.');
  await expect(status).toHaveText(/1 change was not accepted/);
  expect(errors).toEqual([]);
});

test('owner: the same screen in Urdu (RTL)', async ({ page, browserName }) => {
  await openSync(page, OWNER, 'ur');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('1 تبدیلی قبول نہیں ہوئی')).toBeVisible();
  const entry = page.getByTestId('rejected-entry');
  await expect(entry).toContainText('Rose water');
  await expect(entry).toContainText('پروڈکٹس');
  await expect(entry).toContainText('یونٹ قبول نہیں ہوا۔');
  await expect(page.getByRole('button', { name: /دوبارہ کوشش کریں/ })).toBeVisible();
  await expectHeaderNameTruncates(page);
  await screenshot(page, browserName, 'ur');
});

test('cashier: sees that the owner must review, cannot retry', async ({ page, browserName }) => {
  await openSync(page, CASHIER, 'en');
  await expect(page.getByText('The owner needs to review these changes.')).toBeVisible();
  await expect(page.getByTestId('rejected-entry')).toContainText('Rose water');
  await expect(page.getByRole('button', { name: /Try again/ })).toHaveCount(0);
  await expectHeaderNameTruncates(page);
  await screenshot(page, browserName, 'cashier-en');
});
