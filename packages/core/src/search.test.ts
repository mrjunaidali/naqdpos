import { describe, expect, it } from 'vitest';
import { FRESH_PRODUCE } from './presets/freshProduce.ts';
import { matchesSearch, normaliseForSearch, searchItems } from './search.ts';

const items = FRESH_PRODUCE.map((p) => ({
  key: p.key,
  name: p.en,
  name_ur: p.ur,
  search_terms: p.roman,
}));
const find = (query: string) => searchItems(items, query).map((i) => i.key);

// Written as escapes so the letter order is unambiguous: alef madda, lam, waw.
const ALOO = 'آلو';

describe('product search (English, Urdu, Roman Urdu)', () => {
  it('the Urdu test word is آلو (alef madda, lam, waw)', () => {
    expect([...ALOO].map((c) => c.codePointAt(0)!.toString(16))).toEqual(['622', '644', '648']);
    expect(ALOO).toBe('آلو');
  });

  it.each([
    ['aalu', 'potato'],
    ['Aloo', 'potato'],
    [ALOO, 'potato'],
    ['potato', 'potato'],
    ['chaunsa', 'mango_chaunsa'],
    ['tamatar', 'tomato'],
    ['pyaz', 'onion_red'],
  ])('"%s" finds %s', (query, key) => {
    expect(find(query)).toContain(key);
  });

  it('puts the best match first ("aalu" → Potato before Plum/aloo bukhara)', () => {
    expect(find('potato')[0]).toBe('potato');
    expect(find(ALOO)[0]).toBe('potato');
  });

  it('ignores case, spaces, brackets and Urdu spacing', () => {
    expect(find('mango chaunsa')).toContain('mango_chaunsa');
    expect(find('MANGO(CHAUNSA)')).toContain('mango_chaunsa');
    expect(find('آم چونسہ')).toContain('mango_chaunsa');
    expect(find('آمچونسہ')).toContain('mango_chaunsa');
    expect(find('hari  mirch')).toContain('green_chilli_small');
  });

  it('folds Arabic and Urdu letter forms and drops diacritics', () => {
    // Arabic kaf + Arabic yeh instead of Urdu keheh + yeh: کیلا typed as كيلا
    expect(find('كيلا')).toContain('banana');
    // with a zabar on the alef madda word
    expect(normaliseForSearch('آلُو')).toBe(normaliseForSearch(ALOO));
  });

  it('an empty query matches everything; nonsense matches nothing', () => {
    expect(find('')).toHaveLength(FRESH_PRODUCE.length);
    expect(find('zzzz')).toEqual([]);
    expect(matchesSearch({ name: 'Rice', name_ur: null }, 'ric')).toBe(true);
  });
});
