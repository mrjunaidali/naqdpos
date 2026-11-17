import { afterEach, describe, expect, it } from 'vitest';
import en from './en.json';
import ur from './ur.json';
import { i18n, otherLanguage } from './index.ts';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('en.json and ur.json have the same keys', () => {
    expect(keyPaths(ur).sort()).toEqual(keyPaths(en).sort());
  });

  it('starts in English, left-to-right', () => {
    expect(i18n.language).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches <html> to rtl and lang=ur for Urdu, and back', async () => {
    await i18n.changeLanguage('ur');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ur');
    expect(i18n.t('home.welcome')).toBe(ur.home.welcome);

    await i18n.changeLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('otherLanguage toggles between en and ur', () => {
    expect(otherLanguage('en')).toBe('ur');
    expect(otherLanguage('ur')).toBe('en');
  });
});
