// Writes placeholder PWA icons (solid brand colour with a white square) into public/.
// Uses only Node built-ins. Replace the output with real artwork later.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BRAND = [0x15, 0x80, 0x3d];
const WHITE = [0xff, 0xff, 0xff];

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** @param {number} size @param {number} innerRatio share of the width taken by the white square */
function png(size, innerRatio) {
  const inner = Math.round(size * innerRatio);
  const start = Math.floor((size - inner) / 2);
  const end = start + inner;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // leading 0 = no filter
    for (let x = 0; x < size; x++) {
      const inSquare = x >= start && x < end && y >= start && y < end;
      const [r, g, b] = inSquare ? WHITE : BRAND;
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['pwa-192x192.png', 192, 0.4],
  ['pwa-512x512.png', 512, 0.4],
  // Maskable: keep the mark well inside the 80% safe zone.
  ['maskable-512x512.png', 512, 0.3],
  ['apple-touch-icon-180x180.png', 180, 0.4],
];

for (const [name, size, ratio] of icons) {
  writeFileSync(join(publicDir, name), png(size, ratio));
  console.log(`wrote public/${name}`);
}
