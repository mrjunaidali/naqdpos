// ESC/POS raster printing (US036, architecture §6). The receipt is drawn as an image so Urdu prints
// on printers without Urdu fonts: RGBA pixels → 1-bit raster → GS v 0 commands, sent in chunks.

export interface RgbaImage {
  width: number;
  height: number;
  /** width × height × 4 bytes, like ImageData.data. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface MonoBitmap {
  /** Bytes per row: ceil(width / 8). */
  widthBytes: number;
  height: number;
  /** 1 = black, most significant bit = leftmost pixel. */
  bytes: Uint8Array;
}

/** Printer dot widths: 58 mm paper = 384 dots, 80 mm = 576 dots (at 203 dpi). */
export const PRINTER_DOTS = { 58: 384, 80: 576 } as const;

/** Dark (and not transparent) pixels print; luminance below 128 counts as dark. */
export function toMonoRaster(image: RgbaImage): MonoBitmap {
  const widthBytes = Math.ceil(image.width / 8);
  const bytes = new Uint8Array(widthBytes * image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i]!;
      const g = image.data[i + 1]!;
      const b = image.data[i + 2]!;
      const a = image.data[i + 3]!;
      // Integer luminance (×1000) to stay exact.
      const dark = a >= 128 && r * 299 + g * 587 + b * 114 < 128_000;
      if (dark) bytes[y * widthBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height: image.height, bytes };
}

const ESC = 0x1b;
const GS = 0x1d;

/**
 * ESC @ (reset), then the image as GS v 0 bands of at most `bandHeight` rows (small printer
 * buffers cope better), then ESC d n (feed n lines so the receipt clears the tear bar).
 */
export function escposRaster(
  bitmap: MonoBitmap,
  options: { bandHeight?: number; feedLines?: number } = {},
): Uint8Array {
  const bandHeight = options.bandHeight ?? 128;
  const feed = options.feedLines ?? 4;
  const parts: number[] = [ESC, 0x40];
  for (let top = 0; top < bitmap.height; top += bandHeight) {
    const rows = Math.min(bandHeight, bitmap.height - top);
    const xL = bitmap.widthBytes & 0xff;
    const xH = (bitmap.widthBytes >> 8) & 0xff;
    const yL = rows & 0xff;
    const yH = (rows >> 8) & 0xff;
    parts.push(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH);
    const start = top * bitmap.widthBytes;
    for (let i = start; i < start + rows * bitmap.widthBytes; i++) parts.push(bitmap.bytes[i]!);
  }
  parts.push(ESC, 0x64, feed);
  return Uint8Array.from(parts);
}

/** Splits bytes for Bluetooth writes (BLE characteristics take small packets). */
export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('size');
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks;
}
