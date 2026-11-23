import { afterEach, describe, expect, it, vi } from 'vitest';
import en from './en.json';
import ur from './ur.json';
import { formatDate, formatMonth, intlLocale } from './format.ts';
import { i18n, LANGUAGE_STORAGE_KEY, otherLanguage, storedLanguage } from './index.ts';
import { flattenMessages, placeholders } from './reviewSheet.ts';

const enEntries = new Map(flattenMessages(en));
const urEntries = new Map(flattenMessages(ur));
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('en.json and ur.json have the same keys', () => {
    expect([...urEntries.keys()].sort()).toEqual([...enEntries.keys()].sort());
  });

  it('no Urdu string is left as TODO-ur or empty', () => {
    const left = [...urEntries].filter(([, text]) => text.includes('TODO-ur') || !text.trim());
    expect(left).toEqual([]);
  });

  it('every Urdu string has the same {{placeholders}} as the English one', () => {
    const mismatched = [...enEntries]
      .filter(
        ([key, text]) => placeholders(text).join() !== placeholders(urEntries.get(key)!).join(),
      )
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('Urdu strings use Latin digits only', () => {
    const native = [...urEntries].filter(([, text]) => ARABIC_INDIC_DIGITS.test(text));
    expect(native).toEqual([]);
  });

  it('Urdu strings are Urdu: only names and brands stay in Latin letters', () => {
    // Keys whose Urdu is allowed to be Latin-only (brand names, symbols, formats).
    const latinOk = new Set([
      'app.name',
      'language.other',
      'payment.method.jazzcash',
      'payment.method.easypaisa',
      'discount.pct',
    ]);
    const english = [...urEntries]
      .filter(([key]) => !latinOk.has(key))
      .filter(([, text]) => !/[؀-ۿ]/.test(text.replace(/\{\{[^}]+\}\}/g, '')))
      .filter(([, text]) => /[A-Za-z]{3,}/.test(text.replace(/\{\{[^}]+\}\}/g, '')))
      .map(([key]) => key);
    expect(english).toEqual([]);
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

describe('language saved on the device (US009)', () => {
  afterEach(async () => {
    vi.resetModules();
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('saves the chosen language', async () => {
    await i18n.changeLanguage('ur');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ur');
    expect(storedLanguage()).toBe('ur');
    await i18n.changeLanguage('en');
    expect(storedLanguage()).toBe('en');
  });

  it('applies the saved language at start, before anything renders', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ur');
    document.documentElement.dir = 'ltr';
    vi.resetModules();
    const fresh = await import('./index.ts');
    // init is synchronous: Urdu and rtl are in place as soon as the module has loaded.
    expect(fresh.i18n.language).toBe('ur');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ur');
    expect(fresh.i18n.t('nav.home')).toBe(ur.nav.home);
  });

  it('falls back to English for anything else saved or blocked storage', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    expect(storedLanguage()).toBe('en');
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(storedLanguage()).toBe('en');
    spy.mockRestore();
  });
});

describe('dates and numbers', () => {
  it('dates use Urdu month names with Latin digits', () => {
    const tUr = i18n.getFixedT('ur');
    const tEn = i18n.getFixedT('en');
    expect(formatDate('2026-11-03', tUr)).toBe('3 نومبر 2026');
    expect(formatDate('2026-11-03', tEn)).toBe('3 Nov 2026');
    expect(formatMonth('2026-01', tUr)).toBe('جنوری 2026');
    expect(formatMonth('2026-12', tEn)).toBe('Dec 2026');
  });

  it('times in Urdu keep Latin digits', () => {
    const text = new Intl.DateTimeFormat(intlLocale('ur'), {
      timeZone: 'Asia/Karachi',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2026-11-23T11:05:00Z'));
    expect(text).toMatch(/16|4/);
    expect(text).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(text).toContain('نومبر');
  });
});
