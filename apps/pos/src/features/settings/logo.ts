// Shop logo (US014): shrunk on the device, uploaded straight to storage with a pre-signed URL, its
// key saved in shops.logo_path through the outbox, and kept on every device for offline use.
import { LOGO_MAX_BYTES, LOGO_MAX_PX, type LogoContentType, type ShopRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { api } from '../../api/index.ts';
import { getFile, putFile } from '../../api/storage.ts';
import { localWriteMany } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { syncEngine } from '../../sync/index.ts';

export type LogoError = 'unsupported' | 'too_big';

export class LogoNotUsable extends Error {
  constructor(readonly reason: LogoError) {
    super(`logo: ${reason}`);
    this.name = 'LogoNotUsable';
  }
}

/** What shrinking needs from the browser; tests pass a fake. */
export interface ImageTools {
  /** Decodes the picture; throws when the file is not an image the browser can read. */
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource }>;
  /** Draws at this size and encodes; returns the blob (its type says what the browser made). */
  encode(
    source: CanvasImageSource,
    width: number,
    height: number,
    type: LogoContentType,
    quality: number,
  ): Promise<Blob | null>;
}

export const browserImageTools: ImageTools = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  encode(source, width, height, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  },
};

/**
 * At most 256 px on the long side and under 100 KB: WebP with falling quality, else PNG (browsers
 * without a WebP encoder return PNG), shrinking further if a PNG is still too big.
 */
export async function shrinkLogo(
  file: Blob,
  tools: ImageTools = browserImageTools,
): Promise<{ blob: Blob; contentType: LogoContentType }> {
  let image: Awaited<ReturnType<ImageTools['decode']>>;
  try {
    image = await tools.decode(file);
  } catch {
    throw new LogoNotUsable('unsupported');
  }
  if (!image.width || !image.height) throw new LogoNotUsable('unsupported');
  for (const side of [LOGO_MAX_PX, 192, 128]) {
    const scale = Math.min(1, side / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const blob = await tools.encode(image.source, w, h, 'image/webp', quality);
      if (!blob) break;
      if (blob.type !== 'image/webp') break; // no WebP encoder: try PNG below
      if (blob.size <= LOGO_MAX_BYTES) return { blob, contentType: 'image/webp' };
    }
    const png = await tools.encode(image.source, w, h, 'image/png', 1);
    if (png && png.type === 'image/png' && png.size <= LOGO_MAX_BYTES)
      return { blob: png, contentType: 'image/png' };
  }
  throw new LogoNotUsable('too_big');
}

// --- The cached picture (Dexie meta, local only) ---

export const LOGO_META_KEY = 'shop_logo';
interface CachedLogo {
  key: string;
  type: string;
  bytes: ArrayBuffer;
}

async function cachedLogo(): Promise<CachedLogo | null> {
  return ((await db.meta.get(LOGO_META_KEY))?.value as CachedLogo | undefined) ?? null;
}
async function cacheLogo(value: CachedLogo | null): Promise<void> {
  if (value) await db.meta.put({ key: LOGO_META_KEY, value });
  else await db.meta.delete(LOGO_META_KEY);
}

async function currentShop(): Promise<ShopRow | null> {
  const device = await getStoredDevice();
  return (device ? await db.shops.get(device.shop_id) : undefined) ?? null;
}

async function saveLogoPath(key: string | null, actorStaffId: string): Promise<ShopRow> {
  const shop = await currentShop();
  if (!shop) throw new Error('no shop');
  await localWriteMany(
    [
      {
        table: 'shops',
        op: 'upsert',
        row: { ...shop, logo_path: key, updated_at: new Date().toISOString() },
      },
    ],
    db,
    { actorStaffId },
  );
  return shop;
}

/** After the new key is synced, the API deletes the old picture (best effort, logged there). */
function syncThenCleanUp(shopId: string): void {
  void syncEngine
    .syncNow()
    .then(() => api.cleanUpLogos(shopId))
    .catch(() => undefined);
}

/** Owner, online: upload, save the key through the outbox, keep the picture on this device. */
export async function uploadLogo(file: Blob, actorStaffId: string): Promise<void> {
  const shop = await currentShop();
  if (!shop) throw new Error('no shop');
  const { blob, contentType } = await shrinkLogo(file);
  const { key, url } = await api.fileUploadUrl({
    shop_id: shop.id,
    kind: 'logo',
    content_type: contentType,
  });
  await putFile(url, blob, contentType);
  await cacheLogo({ key, type: contentType, bytes: await blob.arrayBuffer() });
  await saveLogoPath(key, actorStaffId);
  syncThenCleanUp(shop.id);
}

export async function removeLogo(actorStaffId: string): Promise<void> {
  const shop = await saveLogoPath(null, actorStaffId);
  await cacheLogo(null);
  syncThenCleanUp(shop.id);
}

/** Downloads the shop's logo when its key changed (once per key; a failure is retried later). */
const inFlight = new Map<string, Promise<void>>();
export function refreshLogoCache(key: string): Promise<void> {
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    if ((await cachedLogo())?.key === key) return;
    const { url } = await api.fileDownloadUrl(key);
    const file = await getFile(url);
    // The key may have changed while downloading: only keep it if it is still the shop's logo.
    if ((await currentShop())?.logo_path === key) await cacheLogo({ key, ...file });
  })()
    .catch(() => undefined)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/**
 * The logo with this key as an object URL for <img>, from the device copy (works offline); null
 * when there is none or it isn't downloaded yet. Downloads a changed logo when online. Reads
 * nothing while the shop has no logo, so screens without one pay nothing for it.
 */
export function useLogoUrl(path: string | null): string | null {
  const cached = useLiveQuery(() => (path ? cachedLogo() : null), [path]) ?? null;
  const fresh = path && cached?.key === path ? cached : null;

  useEffect(() => {
    if (!path || cached?.key === path) return;
    const fetchIt = () => void refreshLogoCache(path);
    if (navigator.onLine) fetchIt();
    window.addEventListener('online', fetchIt);
    return () => window.removeEventListener('online', fetchIt);
  }, [path, cached?.key]);

  const url = useMemo(
    () => (fresh ? URL.createObjectURL(new Blob([fresh.bytes], { type: fresh.type })) : null),
    [fresh],
  );
  useEffect(() => (url ? () => URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

/** The current shop's logo (see useLogoUrl). */
export function useShopLogo(): string | null {
  const path = useLiveQuery(async () => (await currentShop())?.logo_path ?? null) ?? null;
  return useLogoUrl(path);
}
