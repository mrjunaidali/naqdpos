// Builds the POS and admin apps the way the Dockerfiles do, with the e2e API address baked in
// (VITE_API_URL is a build-time setting).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { API_ORIGIN, siteUrl } from './sites.ts';

const root = resolve(import.meta.dirname, '../..');
const env = { ...process.env, VITE_API_URL: API_ORIGIN, VITE_POS_URL: siteUrl('pos') };
for (const app of ['@naqdpos/pos', '@naqdpos/admin']) {
  // pnpm is a .cmd shim on Windows, so it needs a shell; the arguments are fixed.
  const result = spawnSync(`pnpm --filter ${app} build`, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
