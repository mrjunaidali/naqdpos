// Smoke test (deployment §4): each app loads under the production Caddy headers with no CSP
// violation and no console error; the headers themselves are checked too.
import { expect, guard, test } from '../support/guard.ts';
import { API_ORIGIN, FILES_ORIGIN, siteUrl } from '../support/sites.ts';

const CSP_PARTS = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  `connect-src 'self' ${API_ORIGIN} ${FILES_ORIGIN}`,
  `img-src 'self' data: blob: ${FILES_ORIGIN}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
];

test.describe('shop app (pos)', () => {
  test('loads, signs-in screen works, service worker registers', async ({ page, problems }) => {
    const res = await page.goto(siteUrl('pos'));
    const headers = res!.headers();
    for (const part of CSP_PARTS) expect(headers['content-security-policy']).toContain(part);
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cache-control']).toBe('no-cache');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // The service worker (offline app shell) must be allowed by worker-src.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    // The Urdu font and the RTL layout load without a violation too.
    await page.getByRole('button', { name: 'Change language' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.evaluate(() => document.fonts.ready.then(() => true));
    expect(problems.unstubbed).toEqual([]);
  });

  test('deep links get the app shell; hashed assets are immutable; a missing asset is 404', async ({
    page,
    request,
    problems,
  }) => {
    const res = await page.goto(`${siteUrl('pos')}/sale`);
    expect(res!.headers()['cache-control']).toBe('no-cache');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const script = await page
      .locator('script[type="module"][src^="/assets/"]')
      .first()
      .getAttribute('src');
    const asset = await request.get(`${siteUrl('pos')}${script}`);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request.get(`${siteUrl('pos')}/assets/missing-abc123.js`)).status()).toBe(404);
    const manifest = await request.get(`${siteUrl('pos')}/manifest.webmanifest`);
    expect(manifest.headers()['content-type']).toContain('application/manifest+json');
    expect(manifest.headers()['cache-control']).toBe('no-cache');
    expect((await request.get(`${siteUrl('pos')}/sw.js`)).headers()['cache-control']).toBe(
      'no-cache',
    );
    expect(problems.unstubbed).toEqual([]);
  });
});

test.describe('admin portal', () => {
  test('loads its sign-in screen', async ({ page, problems }) => {
    const res = await page.goto(siteUrl('admin'));
    expect(res!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems.unstubbed).toEqual([]);
  });
});

test.describe('the guard itself', () => {
  test('reports an inline script the CSP blocks (so a silent guard cannot pass)', async ({
    browser,
  }) => {
    const page = await browser.newPage();
    const problems = await guard(page);
    await page.goto(siteUrl('pos'));
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__inline = true';
      document.body.append(s);
    });
    await expect.poll(() => problems.csp.length).toBeGreaterThan(0);
    // Blocked: the inline script never ran.
    expect(await page.evaluate(() => (window as { __inline?: boolean }).__inline)).toBeUndefined();
    await page.close();
  });
});
