// The Urdu review sheet (US009).
//   pnpm i18n:export-review              → writes docs/urdu-review.csv (UTF-8 with BOM, for Excel)
//   pnpm i18n:import-review <file.csv>   → applies every non-empty junaid_correction to
//                                          apps/pos/src/i18n/ur.json and the produce presets
// The import refuses the whole file (writes nothing) if any correction changes a {{placeholder}},
// names an unknown key or the file is not UTF-8.
import { readFileSync, writeFileSync } from 'node:fs';
import { FRESH_PRODUCE, PRESET_CATEGORIES } from '../packages/core/src/presets/freshProduce.ts';
import {
  applyPresetNames,
  applyReview,
  buildReviewCsv,
  type Messages,
  type PresetName,
} from '../apps/pos/src/i18n/reviewSheet.ts';

const root = new URL('../', import.meta.url);
const file = (path: string) => new URL(path, root);
const EN = file('apps/pos/src/i18n/en.json');
const UR = file('apps/pos/src/i18n/ur.json');
const PRESETS = file('packages/core/src/presets/freshProduce.ts');
const DEFAULT_SHEET = 'docs/urdu-review.csv';

const readJson = (url: URL) => JSON.parse(readFileSync(url, 'utf8')) as Messages;

function presetNames(): PresetName[] {
  return [
    ...FRESH_PRODUCE.map((p) => ({ key: `preset.${p.key}`, en: p.en, ur: p.ur })),
    ...Object.entries(PRESET_CATEGORIES).map(([key, c]) => ({
      key: `presetCategory.${key}`,
      en: c.en,
      ur: c.ur,
    })),
  ];
}

const [command, path = DEFAULT_SHEET] = process.argv.slice(2);

if (command === 'export') {
  writeFileSync(path, buildReviewCsv(readJson(EN), readJson(UR), presetNames()));
  console.log(`Wrote ${path}`);
} else if (command === 'import') {
  const result = applyReview(readFileSync(path, 'utf8'), readJson(EN), readJson(UR), presetNames());
  if (result.errors.length) {
    console.error(`Nothing was changed. Fix these rows in ${path}:`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  if (result.applied.length === 0) {
    console.log('No corrections to apply.');
  } else {
    writeFileSync(UR, JSON.stringify(result.ur, null, 2) + '\n');
    if (result.presetUr.size) {
      writeFileSync(PRESETS, applyPresetNames(readFileSync(PRESETS, 'utf8'), result.presetUr));
    }
    for (const a of result.applied) console.log(`${a.key}: ${a.from} → ${a.to}`);
    console.log(
      `Applied ${result.applied.length} correction(s). Run pnpm i18n:export-review for a fresh sheet, then pnpm test.`,
    );
  }
} else {
  console.error('Usage: node scripts/urdu-review.ts export [file.csv] | import <file.csv>');
  process.exit(1);
}
