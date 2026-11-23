import { describe, expect, it } from 'vitest';
import { logoKey, logoPrefix, parseFileKey } from './files.ts';

const SHOP = '019a9b8e-0000-7000-8000-00000000000b';
const ID = '019a9b8e-1111-7000-8000-000000000001';

describe('file keys (architecture §9)', () => {
  it('logo keys: a new key per upload, under the shop', () => {
    expect(logoKey(SHOP, ID, 'image/webp')).toBe(`logos/${SHOP}/logo-${ID}.webp`);
    expect(logoKey(SHOP, ID, 'image/png')).toBe(`logos/${SHOP}/logo-${ID}.png`);
    expect(logoKey(SHOP, ID, 'image/webp').startsWith(logoPrefix(SHOP))).toBe(true);
  });

  it('parses only keys on the list', () => {
    expect(parseFileKey(`logos/${SHOP}/logo-${ID}.webp`)).toEqual({
      kind: 'logo',
      shopId: SHOP,
      contentType: 'image/webp',
    });
    expect(parseFileKey(`logos/${SHOP}/logo-${ID}.png`)?.contentType).toBe('image/png');
    for (const bad of [
      `logos/${SHOP}/logo.webp`,
      `logos/${SHOP}/logo-${ID}.jpg`,
      `logos/${SHOP}/../other/logo-${ID}.webp`,
      `logos/${SHOP}/logo-${ID}.webp/../../x`,
      `/logos/${SHOP}/logo-${ID}.webp`,
      `bill-photos/${SHOP}/${ID}.jpg`,
      `backups/daily/2026-11-23.dump.enc`,
      `logos/not-a-uuid/logo-${ID}.webp`,
      `logos/${SHOP.toUpperCase()}/logo-${ID}.webp`,
      '',
    ])
      expect(parseFileKey(bad), bad).toBeNull();
  });
});
