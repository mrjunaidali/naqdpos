// Stored files (architecture §9): rows keep object keys, never URLs. One list of the keys the
// API will sign; anything else is refused. Only the shop logo (US014) for now.

export const LOGO_CONTENT_TYPES = ['image/webp', 'image/png'] as const;
export type LogoContentType = (typeof LOGO_CONTENT_TYPES)[number];

/** The device shrinks the picture before upload (US014). */
export const LOGO_MAX_PX = 256;
export const LOGO_MAX_BYTES = 100 * 1024;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LOGO = new RegExp(`^logos/(${UUID})/logo-(${UUID})\\.(webp|png)$`);

const EXT: Record<LogoContentType, 'webp' | 'png'> = { 'image/webp': 'webp', 'image/png': 'png' };

/**
 * `logos/<shop_id>/logo-<uuidv7>.webp`: a new key per upload, so other devices see the change
 * and caches never serve an old picture.
 */
export function logoKey(shopId: string, id: string, contentType: LogoContentType): string {
  return `logos/${shopId}/logo-${id}.${EXT[contentType]}`;
}

export type FileKey = { kind: 'logo'; shopId: string; contentType: LogoContentType };

/** What a key is and which shop it belongs to; null for anything not on the list. */
export function parseFileKey(key: string): FileKey | null {
  const m = LOGO.exec(key);
  if (!m) return null;
  return { kind: 'logo', shopId: m[1]!, contentType: m[3] === 'png' ? 'image/png' : 'image/webp' };
}

/** The folder of one shop's logos (for clean-up after a new logo is saved). */
export const logoPrefix = (shopId: string) => `logos/${shopId}/`;
