// A Playwright fixture that fails a test on any CSP violation, console error or page error, and a
// stub API (page.route) so the apps load without a server. Requests to the stub still go through
// the browser's CSP checks (connect-src), because routing happens after them.
import { test as base, expect, type Page } from '@playwright/test';
import { API_ORIGIN } from './sites.ts';

/** Answers for the API calls the signed-out apps make; anything else is reported. */
const STUB: Record<string, unknown> = {
  '/config': { google: false, files: false },
  '/health': { ok: true, db: true },
};

export interface Problems {
  csp: string[];
  console: string[];
  unstubbed: string[];
}

export async function guard(page: Page): Promise<Problems> {
  const problems: Problems = { csp: [], console: [], unstubbed: [] };
  // securitypolicyviolation fires in the page for every blocked script, style, image or request.
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`);
    });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    (/Content.Security.Policy|CSP violation/i.test(text) ? problems.csp : problems.console).push(
      text,
    );
  });
  page.on('pageerror', (error) => problems.console.push(`page error: ${error.message}`));
  await page.route(`${API_ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path in STUB)
      return route.fulfill({ json: STUB[path], headers: { 'access-control-allow-origin': '*' } });
    problems.unstubbed.push(`${route.request().method()} ${path}`);
    return route.fulfill({
      status: 404,
      json: { error: 'not_found' },
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return problems;
}

export const test = base.extend<{ problems: Problems }>({
  problems: async ({ page }, use) => {
    const problems = await guard(page);
    await use(problems);
    expect(problems.csp, 'CSP violations').toEqual([]);
    expect(problems.console, 'console errors').toEqual([]);
  },
});
export { expect };
