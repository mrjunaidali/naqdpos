// The e2e sites: the real Vite builds served by Caddy with deploy/Caddyfile (the same config and
// headers as production). The API origin is a fixed address the tests stub with page.route, so the
// browser still enforces the CSP on it; a later offline-sale test can point at a real API instead.

export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:4199';
export const FILES_ORIGIN = 'https://files.e2e.test';

export const SITES = {
  pos: { port: 4173, dist: 'apps/pos/dist' },
  admin: { port: 4174, dist: 'apps/admin/dist' },
} as const;
export type Site = keyof typeof SITES;

export const siteUrl = (site: Site) => `http://127.0.0.1:${SITES[site].port}`;
