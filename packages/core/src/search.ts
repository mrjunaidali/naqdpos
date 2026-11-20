// Product search (US072, sale screen later). Matches English, Urdu and Roman Urdu spellings,
// ignoring case, spaces, brackets and punctuation, Urdu diacritics, and the Arabic/Urdu letter
// variants keyboards produce (ي/ی, ك/ک, ه/ہ…). In memory: a shop has hundreds of products.

/** Arabic-script letters typed differently on different keyboards → one Urdu form. */
const FOLD: Record<string, string> = {
  ي: 'ی', // Arabic yeh → Farsi yeh (ی)
  ى: 'ی', // alef maksura → ی
  ے: 'ی', // yeh barree (ے) → ی (end form of the same letter)
  ك: 'ک', // Arabic kaf → keheh (ک)
  ه: 'ہ', // heh → heh goal (ہ)
  ھ: 'ہ', // heh doachashmee (ھ) → ہ
  ة: 'ہ', // teh marbuta → ہ
  أ: 'ا', // alef with hamza → alef
  إ: 'ا',
};

/**
 * Lowercase; drop diacritics, tatweel and joiners; fold letter variants; keep only letters and
 * digits. Alef madda (آ) stays, because آلو and الو are different words.
 */
export function normaliseForSearch(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFC')
      // Urdu/Arabic diacritics (zabar, zer, pesh, tashdeed…), superscript alef, tatweel
      .replace(/[ً-ٰٟـ]/g, '')
      // zero-width joiners and non-joiners
      .replace(/[‌‍]/g, '')
      .replace(/./gu, (ch) => FOLD[ch] ?? ch)
      .replace(/[^\p{L}\p{N}]/gu, '')
  );
}

export interface Searchable {
  name: string;
  name_ur: string | null;
  search_terms?: readonly string[];
}

/** True when the query (normalised) appears in the name, Urdu name or any search term. */
export function matchesSearch(item: Searchable, query: string): boolean {
  const needle = normaliseForSearch(query);
  if (!needle) return true;
  const haystacks = [item.name, item.name_ur ?? '', ...(item.search_terms ?? [])];
  return haystacks.some((text) => normaliseForSearch(text).includes(needle));
}

/** Items matching the query; names that start with it come first. */
export function searchItems<T extends Searchable>(items: readonly T[], query: string): T[] {
  const needle = normaliseForSearch(query);
  if (!needle) return [...items];
  const starts = (item: T) =>
    [item.name, item.name_ur ?? '', ...(item.search_terms ?? [])].some((t) =>
      normaliseForSearch(t).startsWith(needle),
    );
  return items
    .filter((item) => matchesSearch(item, query))
    .sort((a, b) => Number(starts(b)) - Number(starts(a)));
}
