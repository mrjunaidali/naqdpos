// Day Close on a seeded shop (bug 2026-11-25: "UnknownError: Unable to open cursor" on iPhone).
// The app opens once so Dexie creates its schema, then the test writes a signed-in owner device
// and a day of ledger rows straight into IndexedDB and opens /closing. Runs on Chromium and WebKit
// (WebKit is what iPhone Safari and the installed PWA use).
//
// The page runs in a persistent profile on purpose: Playwright's normal contexts are ephemeral, and
// ephemeral WebKit keeps IndexedDB in memory. Phones keep it in SQLite, which is where "Unable to
// open cursor" comes from, so only a profile on disk exercises the same IndexedDB backend.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { API_ORIGIN, siteUrl } from '../support/sites.ts';

const SHOP = '01900000-0000-7000-8000-000000000001';
const OWNER = '01900000-0000-7000-8000-000000000002';
const DEVICE = '01900000-0000-7000-8000-000000000003';
const CUSTOMER = '01900000-0000-7000-8000-000000000004';
const PRODUCT = '01900000-0000-7000-8000-000000000005';
const CATEGORY = '01900000-0000-7000-8000-000000000006';

const test = base.extend<{ page: Page }>({
  page: async ({ playwright, browserName, viewport, userAgent, isMobile, hasTouch }, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'naqdpos-e2e-'));
    const context = await playwright[browserName].launchPersistentContext(dir, {
      viewport,
      // exactOptionalPropertyTypes: leave userAgent out rather than pass undefined.
      ...(userAgent ? { userAgent } : {}),
      // Firefox has no mobile emulation; the other two take the project's device settings.
      ...(browserName === 'firefox' ? {} : { isMobile, hasTouch }),
    });
    await use(context.pages()[0] ?? (await context.newPage()));
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
});

/** A date in Asia/Karachi, `days` before today. */
function karachiDate(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
}

function seed(day: string, prevDay: string) {
  const now = new Date().toISOString();
  const common = { shop_id: SHOP, created_at: now, device_id: DEVICE, server_seq: null };
  const id = (n: number) => `01900000-0000-7000-8001-${String(n).padStart(12, '0')}`;
  const sale = (n: number, total: number) => ({
    ...common,
    id: id(n),
    receipt_no: `A1-${n}`,
    business_date: day,
    staff_id: OWNER,
    customer_id: null,
    order_type: 'walk_in',
    source: 'pos',
    subtotal_paisa: total,
    discount_paisa: 0,
    rounding_paisa: 0,
    total_paisa: total,
    note: null,
    discount_approved_by_staff_id: null,
  });
  const payment = (
    n: number,
    saleN: number | null,
    kind: string,
    method: string,
    amount: number,
  ) => ({
    ...common,
    id: id(n),
    business_date: day,
    kind,
    sale_id: saleN === null ? null : id(saleN),
    customer_id: saleN === null ? CUSTOMER : null,
    method_code: method,
    amount_paisa: amount,
    reference: null,
    staff_id: OWNER,
  });
  const line = (n: number, saleN: number, total: number) => ({
    ...common,
    id: id(n),
    sale_id: id(saleN),
    product_id: PRODUCT,
    name_snapshot: 'Apples',
    name_ur_snapshot: null,
    unit_snapshot: 'kg',
    qty_milli: 1000,
    unit_price_paisa: total,
    discount_paisa: 0,
    is_foc: false,
    by_amount: false,
    line_total_paisa: total,
  });
  const movement = (n: number, saleN: number) => ({
    ...common,
    id: id(n),
    product_id: PRODUCT,
    business_date: day,
    qty_milli: -1000,
    reason: 'sale',
    ref_id: id(saleN),
    note: null,
    staff_id: OWNER,
  });
  const expense = (n: number, amount: number, reverses: number | null) => ({
    ...common,
    id: id(n),
    business_date: day,
    category_id: CATEGORY,
    amount_paisa: amount,
    paid_method_code: 'cash',
    note: null,
    payee: null,
    payee_staff_id: null,
    staff_id: OWNER,
    approved_by_staff_id: null,
    reverses_expense_id: reverses === null ? null : id(reverses),
    reversal_reason: reverses === null ? null : 'typo',
    recurring_expense_id: null,
  });
  const mutable = { created_at: now, updated_at: now, deleted_at: null, server_seq: null };
  return {
    meta: [
      { key: 'session', value: { token: 't', user_id: 'u', email: 'o@e2e.test', checked_at: now } },
      {
        key: 'device',
        value: { id: DEVICE, code: 'A1', shop_id: SHOP, mode: 'owner', staff_id: OWNER },
      },
      { key: 'current_staff', value: { staff_id: OWNER, switched_at: now } },
    ],
    shops: [
      {
        ...mutable,
        id: SHOP,
        name: 'E2E Fruits',
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
        ...mutable,
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
    expense_categories: [
      { ...mutable, id: CATEGORY, shop_id: SHOP, key: 'other', name: 'Other', device_id: null },
    ],
    // Cash Rs 1,000; wallet Rs 500; split Rs 300 cash + Rs 200 easypaisa.
    sales: [sale(1, 100_000), sale(2, 50_000), sale(3, 50_000), sale(4, 25_000)],
    sale_lines: [
      line(11, 1, 100_000),
      line(12, 2, 50_000),
      line(13, 3, 50_000),
      line(14, 4, 25_000),
    ],
    payments: [
      payment(21, 1, 'sale', 'cash', 100_000),
      payment(22, 2, 'sale', 'jazzcash', 50_000),
      payment(23, 3, 'sale', 'cash', 30_000),
      payment(24, 3, 'sale', 'easypaisa', 20_000),
      // Rs 250 credit sale, then Rs 250 cash received on khata.
      payment(25, null, 'khata_receipt', 'cash', 25_000),
    ],
    khata_entries: [
      {
        ...common,
        id: id(31),
        customer_id: CUSTOMER,
        business_date: day,
        type: 'credit_sale',
        amount_paisa: 25_000,
        sale_id: id(4),
        payment_id: null,
        note: null,
        staff_id: OWNER,
      },
      {
        ...common,
        id: id(32),
        customer_id: CUSTOMER,
        business_date: day,
        type: 'payment',
        amount_paisa: -25_000,
        sale_id: null,
        payment_id: id(25),
        note: null,
        staff_id: OWNER,
      },
    ],
    customers: [
      {
        ...mutable,
        id: CUSTOMER,
        shop_id: SHOP,
        mobile: '03001234567',
        name: 'Customer',
        device_id: null,
      },
    ],
    // Rs 150 and Rs 80 cash expenses; the Rs 80 one is reversed.
    expenses: [expense(41, 15_000, null), expense(42, 8_000, null), expense(43, -8_000, 42)],
    stock_movements: [movement(51, 1), movement(52, 2), movement(53, 3), movement(54, 4)],
    // Previous close: counted Rs 5,000, owner took Rs 1,000 → opening Rs 4,000.
    day_closes: [
      {
        id: id(61),
        shop_id: SHOP,
        business_date: prevDay,
        opening_cash_paisa: 0,
        expected_cash_paisa: 500_000,
        counted_cash_paisa: 500_000,
        difference_paisa: 0,
        owner_withdrawal_paisa: 100_000,
        note: null,
        closed_by_staff_id: OWNER,
        closed_at: now,
        seen_through_seq: 0,
        device_id: DEVICE,
        server_seq: null,
      },
    ],
  };
}

/** Writes rows into the app's IndexedDB (created by Dexie on the first load). */
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

/**
 * Real iOS WebKit refuses some IndexedDB index cursors with "UnknownError: Unable to open cursor"
 * (bug 2026-11-25); Playwright's WebKit (another IndexedDB backend) does not, so the test makes the
 * browser refuse them the same way. 'unique': key/value cursors in a unique direction on an index
 * (Dexie's uniqueKeys()); 'index': every cursor on an index (also anyOf(), orderBy() on an index),
 * except receipt_no, whose plain forward cursor the selling flow uses and iPhones run every sale.
 * Day Close must work with both: it reads with single-field equals() / toArray() only.
 */
type CursorLimit = 'none' | 'unique' | 'index';

async function emulateIosCursors(page: Page, limit: CursorLimit) {
  await page.addInitScript((limit) => {
    if (limit === 'none') return;
    for (const name of ['openCursor', 'openKeyCursor'] as const) {
      const proto = IDBIndex.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      const original = proto[name]!;
      proto[name] = function (this: IDBIndex, ...args: unknown[]) {
        const direction = args[1];
        // receipt_no: the receipt counter's forward cursor (app start, every sale) runs on iPhones.
        const strict = limit === 'index' && this.name !== 'receipt_no';
        if (strict || direction === 'nextunique' || direction === 'prevunique') {
          throw new DOMException('Unable to open cursor', 'UnknownError');
        }
        return original.apply(this, args);
      };
    }
  }, limit);
}

for (const limit of ['none', 'unique', 'index'] as const) {
  test(`Day Close opens with the right expected cash on a seeded shop (iOS cursor limits: ${limit})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => {
      // WebKit reports the stub's aborted cross-origin API calls as page errors ("… due to access
      // control checks") even though the app handles the failed fetch; anything else counts.
      const aborted =
        e.message.includes('access control checks') && e.message.includes(new URL(API_ORIGIN).host);
      if (!aborted) errors.push(e.message);
    });
    await emulateIosCursors(page, limit);
    // Offline from the app's point of view: every API call fails, so sync gives up and the screen
    // closes offline (the selling flow never waits for the network).
    await page.route(`${API_ORIGIN}/**`, (route) => route.abort('internetdisconnected'));

    await page.goto(siteUrl('pos'));
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await writeRows(page, seed(karachiDate(1), karachiDate(2)));

    await page.goto(`${siteUrl('pos')}/closing`);
    await expect(page.getByRole('heading', { name: /^Close day — / })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Unable to open cursor')).toHaveCount(0);
    // Opening Rs 4,000 + cash sales Rs 1,300 + khata cash Rs 250 − expenses Rs 150 = Rs 5,400.
    await expect(page.getByLabel('Opening cash (Rs)')).toHaveValue('4000');
    const expected = page.locator('p', { hasText: 'Expected cash' });
    await expect(expected).toContainText('5,400');
    expect(errors).toEqual([]);
  });
}

for (const language of ['en', 'ur'] as const) {
  test(`a read that keeps failing shows the friendly screen, never the raw error page (${language})`, async ({
    page,
  }) => {
    // Every index read fails like a lost connection: reopen-and-retry gives up, the route asks
    // for a reload. Before the fix this was React Router's "Unexpected Application Error!".
    await page.addInitScript(() => {
      for (const name of ['getAll', 'openCursor', 'openKeyCursor'] as const) {
        const proto = IDBIndex.prototype as unknown as Record<string, unknown>;
        proto[name] = () => {
          throw new DOMException('Unable to open cursor', 'UnknownError');
        };
      }
    });
    await page.route(`${API_ORIGIN}/**`, (route) => route.abort('internetdisconnected'));
    await page.goto(siteUrl('pos'));
    await page.evaluate((lng) => localStorage.setItem('naqdpos.language', lng), language);
    await writeRows(page, seed(karachiDate(1), karachiDate(2)));
    await page.goto(`${siteUrl('pos')}/closing`);

    const screen = page.getByTestId('route-error');
    await expect(screen).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    if (language === 'en') {
      await expect(screen).toContainText('Please reload the app');
      await expect(page.getByRole('button', { name: 'Reload app' })).toBeVisible();
    } else {
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('button', { name: 'ایپ دوبارہ لوڈ کریں' })).toBeVisible();
    }
  });
}
