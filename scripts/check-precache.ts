// `pnpm check:precache`: after a build, the service worker must precache everything the app needs
// to open and sell offline on first launch (architecture §6): the app shell, the Urdu font, the
// icons and the manifest. (The i18n JSON is bundled into the JS.) Fails with a list of what is missing.
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../apps/pos/dist/sw.js', import.meta.url), 'utf8');
const required: [string, RegExp][] = [
  ['app shell (index.html)', /"index\.html"/],
  ['app JavaScript', /assets\/index-[\w-]+\.js/],
  ['styles', /assets\/index-[\w-]+\.css/],
  ['Urdu font 400', /noto-naskh-arabic-arabic-400-normal-[\w-]+\.woff2/],
  ['Urdu font 700', /noto-naskh-arabic-arabic-700-normal-[\w-]+\.woff2/],
  ['icon 192', /pwa-192x192\.png/],
  ['icon 512', /pwa-512x512\.png/],
  ['manifest', /manifest\.webmanifest/],
];
const missing = required.filter(([, pattern]) => !pattern.test(sw)).map(([name]) => name);
if (missing.length) {
  console.error(`Precache is missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Precache OK: ${required.map(([name]) => name).join(', ')}`);
