// Sales history (26 Nov 2026): owners pick Today / Yesterday / This week / Custom, cashiers see
// only their own sales of the open business day. At 375px, English and Urdu, with iOS WebKit's
// index-cursor limits emulated (bug 2026-11-25): the screen reads one business_date at a time
// with equals(). Screenshots in test-results/screenshots/.
import { expect, test, type Page } from '@playwright/test';
import { API_ORIGIN, siteUrl } from '../support/sites.ts';
import { DEVICE, mutable, OWNER, ownerDevice, SHOP, writeRows } from '../support/seed.ts';

const CASHIER = '01900000-0000-7000-8000-000000000209';

test.use({ viewport: { width: 375, height: 800 }, serviceWorkers: 'block' });

/** A date in Asia/Karachi, `days` before today. */
function karachiDate(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
}

let n = 0;
function sale(daysAgo: number, total: number, staff = OWNER) {
  n += 1;
  const date = karachiDate(daysAgo);
  return {
    id: `01900000-0000-7000-8003-${String(1000 - daysAgo * 10 + n).padStart(12, '0')}`,
    shop_id: SHOP,
    receipt_no: `A1-${String(n).padStart(6, '0')}`,
    business_date: date,
    staff_id: staff,
    customer_id: null,
    order_type: 'walk_in',
    source: 'walk_in',
    subtotal_paisa: total,
    discount_paisa: 0,
    rounding_paisa: 0,
    total_paisa: total,
    note: null,
    discount_approved_by_staff_id: null,
    created_at: `${date}T07:00:00.000Z`,
    device_id: DEVICE,
    server_seq: 1,
  };
}

async function open(page: Page, language: 'en' | 'ur', asCashier = false) {
  await page.addInitScript(() => {
    // iOS WebKit refuses some index cursors; refuse them all so only getAll() reads work.
    const proto = IDBIndex.prototype as unknown as Record<string, unknown>;
    for (const name of ['openCursor', 'openKeyCursor']) {
      const original = proto[name] as (...a: unknown[]) => unknown;
      proto[name] = function (this: IDBIndex, ...args: unknown[]) {
        // receipt_no: the receipt counter's forward cursor runs on iPhones on every sale.
        if (this.name === 'receipt_no') return original.apply(this, args);
        throw new DOMException('Unable to open cursor', 'UnknownError');
      };
    }
  });
  await page.route(`${API_ORIGIN}/**`, (route) => route.abort('internetdisconnected'));
  await page.goto(siteUrl('pos'));
  await page.evaluate((lng) => localStorage.setItem('naqdpos.language', lng), language);
  const base = ownerDevice('Mian Sami Fruits');
  const rows: Record<string, unknown[]> = {
    ...base,
    staff: [
      ...base.staff,
      {
        ...mutable(),
        id: CASHIER,
        shop_id: SHOP,
        name: 'Bilal',
        phone: null,
        role: 'cashier',
        pin_hash: null,
        membership_user_id: null,
        active: true,
        device_id: null,
      },
    ],
    sales: [
      sale(9, 90_000),
      sale(3, 30_000),
      sale(1, 20_000),
      sale(0, 10_000),
      sale(0, 15_000, CASHIER),
    ],
  };
  if (asCashier) {
    rows.meta = base.meta.map((m) =>
      m.key === 'device'
        ? { key: 'device', value: { ...(m.value as object), mode: 'shop' } }
        : m.key === 'current_staff'
          ? {
              key: 'current_staff',
              value: { staff_id: CASHIER, switched_at: new Date().toISOString() },
            }
          : m,
    );
  }
  await writeRows(page, rows);
  await page.goto(`${siteUrl('pos')}/sales`);
}

const receipts = (page: Page) => page.getByRole('link', { name: /A1-\d{6}/ });

test('owner: Today, Yesterday, This week and Custom; link to Reports (en)', async ({
  page,
  browserName,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    if (!e.message.includes('access control checks')) errors.push(e.message);
  });
  await open(page, 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Sales — /);
  await expect(receipts(page)).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'See older in Reports' })).toBeVisible();

  await page.getByRole('button', { name: 'Yesterday' }).click();
  await expect(receipts(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'This week' }).click();
  await expect(receipts(page)).toHaveCount(4);
  await expect(page).toHaveURL(/range=week/);
  if (browserName === 'webkit') {
    await page.screenshot({ path: 'test-results/screenshots/sales-webkit-375-en.png' });
  }

  await page.getByRole('button', { name: 'Custom' }).click();
  await page.getByLabel('From').fill(karachiDate(10));
  await page.getByLabel('To').fill(karachiDate(0));
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(receipts(page)).toHaveCount(5);
  await expect(page.getByText('Unable to open cursor')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('owner: the same screen in Urdu (RTL)', async ({ page, browserName }) => {
  await open(page, 'ur');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^سیل — /);
  await page.getByRole('button', { name: 'یہ ہفتہ' }).click();
  await expect(receipts(page)).toHaveCount(4);
  if (browserName === 'webkit') {
    await page.screenshot({ path: 'test-results/screenshots/sales-webkit-375-ur.png' });
  }
});

test('cashier: own sales of the open business day only, no picker', async ({
  page,
  browserName,
}) => {
  await open(page, 'en', true);
  await expect(page.getByText('Your sales for this business day.')).toBeVisible();
  await expect(receipts(page)).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Show sales for' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'See older in Reports' })).toHaveCount(0);
  if (browserName === 'webkit') {
    await page.screenshot({ path: 'test-results/screenshots/sales-webkit-375-cashier-en.png' });
  }
});
