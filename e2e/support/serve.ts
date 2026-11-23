// `node support/serve.ts <pos|admin>`: serves one built app with Caddy and deploy/Caddyfile
// (Playwright starts one per site). Caddy comes from CADDY_BIN or PATH.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_ORIGIN, FILES_ORIGIN, SITES, type Site } from './sites.ts';

const site = process.argv[2] as Site;
if (!(site in SITES)) {
  console.error('usage: node support/serve.ts pos|admin');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '../..');
const dist = resolve(root, SITES[site].dist);
if (!existsSync(resolve(dist, 'index.html'))) {
  console.error(`${dist} has no build: run pnpm --filter @naqdpos/e2e build:apps first`);
  process.exit(1);
}

const caddy = spawn(
  process.env.CADDY_BIN ?? 'caddy',
  ['run', '--config', resolve(root, 'deploy/Caddyfile'), '--adapter', 'caddyfile'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(SITES[site].port),
      SITE_ROOT: dist,
      API_ORIGIN,
      FILES_ORIGIN,
    },
  },
);
caddy.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => caddy.kill(signal));
