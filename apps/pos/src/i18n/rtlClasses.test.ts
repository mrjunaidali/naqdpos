import { describe, expect, it } from 'vitest';

// US009: screens mirror in Urdu only if they use logical sides (ms-/pe-/start-/text-end …).
// Physical left/right utilities would stay put in RTL, so they are not allowed in the app.
const sources = import.meta.glob<string>(['../**/*.tsx', '../**/*.css', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const PHYSICAL =
  /(?<![\w-])(?:-?m[lr]|p[lr]|-?left|-?right|text-left|text-right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|space-x|-?translate-x|float-left|float-right|scroll-[mp][lr])-[\w[\]./%-]+|(?<![\w-])(?:margin|padding|border)-(?:left|right)\s*:|(?<![\w-])(?:left|right)\s*:\s*\d/g;

describe('RTL-safe styles', () => {
  it('found the app sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('uses logical sides instead of left/right', () => {
    const found = Object.entries(sources).flatMap(([file, text]) =>
      // Comments say "left-to-right"; that is prose, not a class.
      [...text.replace(/left-to-right|right-to-left/g, '').matchAll(PHYSICAL)].map(
        (m) => `${file}: ${m[0]}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
