// New Sale product tiles are centred at every width and in both languages (bug 2026-11-26:
// "product tiles right-aligned on mobile"). For each tile the rendered extent of the icon, the
// name and the price (a Range around their text, not the element box, which may span the tile)
// must be centred on the tile within 2px. WebKit screenshots in test-results/screenshots/.
import { expect, test, type Page } from '@playwright/test';
import { API_ORIGIN, siteUrl } from '../support/sites.ts';
import { ownerDevice, product, writeRows } from '../support/seed.ts';

const id = (n: number) => `01900000-0000-7000-8002-${String(n).padStart(12, '0')}`;
const PRODUCTS = [
  product({
    id: id(1),
    name: 'Tomato',
    name_ur: 'ٹماٹر',
    unit: 'kg',
    sale_price_paisa: 16_000,
    icon: '🍅',
    sort: 1,
  }),
  product({
    id: id(2),
    name: 'Egg',
    name_ur: 'انڈا',
    unit: 'piece',
    sale_price_paisa: 2_500,
    icon: '🥚',
    sort: 2,
  }),
  product({
    id: id(3),
    name: 'Lemon',
    name_ur: 'لیموں',
    unit: 'kg',
    sale_price_paisa: 30_000,
    icon: null,
    sort: 3,
  }),
  product({
    id: id(4),
    name: 'Seedless green grapes from Kandahar, premium box',
    name_ur: 'قندھار کے بغیر بیج کے سبز انگور، پریمیم ڈبہ',
    unit: 'piece',
    sale_price_paisa: 150_000,
    icon: null,
    sort: 4,
  }),
];

interface Offset {
  tile: string;
  part: string;
  offset: number;
}

/** Distance between each part's rendered centre and its tile's centre. */
function offsets(page: Page): Promise<Offset[]> {
  return page.getByTestId('product-tile').evaluateAll((tiles) => {
    const out: { tile: string; part: string; offset: number }[] = [];
    const textBox = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    for (const tile of tiles) {
      const t = tile.getBoundingClientRect();
      const centre = t.left + t.width / 2;
      for (const part of ['icon', 'name', 'price']) {
        const el = tile.querySelector(`[data-part="${part}"]`);
        if (!el || !el.textContent?.trim()) continue; // a tile without an icon
        const box = textBox(el);
        out.push({
          tile: tile.getAttribute('title') ?? tile.textContent ?? '',
          part,
          offset: Math.round(Math.abs(box.left + box.width / 2 - centre) * 10) / 10,
        });
      }
    }
    return out;
  });
}

for (const width of [375, 1280]) {
  for (const language of ['en', 'ur'] as const) {
    test.describe(`${width}px, ${language}`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('icon, name and price are centred in every tile', async ({ page, browserName }) => {
        await page.route(`${API_ORIGIN}/**`, (route) => route.abort('internetdisconnected'));
        await page.goto(siteUrl('pos'));
        await page.evaluate((lng) => localStorage.setItem('naqdpos.language', lng), language);
        await writeRows(page, { ...ownerDevice(), products: PRODUCTS });
        await page.goto(`${siteUrl('pos')}/sale`);

        const tiles = page.getByTestId('product-tile');
        await expect(tiles).toHaveCount(PRODUCTS.length, { timeout: 15_000 });
        const measured = await offsets(page);
        // 4 names + 4 prices + 2 icons.
        expect(measured).toHaveLength(10);
        expect(measured.filter((m) => m.offset > 2)).toEqual([]);

        // Tiles with and without an icon, short or long name, are all the same height.
        const heights = await tiles.evaluateAll((els) =>
          els.map((el) => Math.round(el.getBoundingClientRect().height)),
        );
        expect(new Set(heights).size, heights.join(', ')).toBe(1);

        if (browserName === 'webkit') {
          await page.screenshot({
            path: `test-results/screenshots/tiles-webkit-${width}-${language}.png`,
          });
        }
      });
    });
  }
}
