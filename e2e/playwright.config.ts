// End-to-end tests (Playwright): the real builds behind the real Caddy config. Today: a smoke test
// per app (loads, no CSP violation, no console error). Later: an offline sale on the installed POS
// (same sites; a real API in place of the stub).
import { defineConfig, devices } from '@playwright/test';
import { SITES, siteUrl } from './support/sites.ts';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: (Object.keys(SITES) as (keyof typeof SITES)[]).map((site) => ({
    command: `node support/serve.ts ${site}`,
    url: siteUrl(site),
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
});
