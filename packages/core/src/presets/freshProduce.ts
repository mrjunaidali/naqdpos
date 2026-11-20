// Built-in fresh produce list (US072, docs/features/produce-presets.md): 34 vegetables, 9 greens
// and herbs, 40 fruits. No prices: rates follow the daily mandi rate. Urdu names from the spec
// ("Urdu to be verified by Junaid"). Roman Urdu spellings are search aids only and are NOT yet
// checked: every list is marked `// verify: Junaid`.
import type { ProductUnit } from '../catalogue.ts';

export type PresetCategory = 'vegetables' | 'greens' | 'fruits';

export interface ProducePreset {
  /** Stable id of the preset (not stored on products). */
  key: string;
  category: PresetCategory;
  /** Varieties share a group and are shown together (e.g. all mangoes). */
  group: string;
  en: string;
  ur: string;
  /** Roman Urdu spellings people type; copied into products.search_terms. */
  roman: readonly string[];
  unit: ProductUnit;
  /** Usually given free with vegetables (the owner still sets the FOC rule). */
  focDefault: boolean;
  /** Only affects sort order in the picker. */
  seasonal: boolean;
  /** Tile picture (US078), copied to products.icon; null where no emoji fits. */
  icon: string | null;
}

/** The three categories created on demand, with both names (spec "Rules"). */
export const PRESET_CATEGORIES: Record<PresetCategory, { en: string; ur: string; sort: number }> = {
  vegetables: { en: 'Vegetables', ur: 'سبزیاں', sort: 1 },
  greens: { en: 'Greens & herbs', ur: 'ساگ اور ہرے مصالحے', sort: 2 },
  fruits: { en: 'Fruits', ur: 'پھل', sort: 3 },
};

/**
 * Picture per preset (US078): the closest common food emoji, or null where nothing fits well
 * (a wrong picture misleads more than none). Not yet checked: every line is `// verify: Junaid`.
 */
export const PRESET_ICONS: Record<string, string | null> = {
  potato: '🥔', // verify: Junaid
  potato_red: '🥔', // verify: Junaid
  onion_red: '🧅', // verify: Junaid
  onion_white: '🧅', // verify: Junaid
  tomato: '🍅', // verify: Junaid
  garlic: '🧄', // verify: Junaid
  ginger: '🫚', // verify: Junaid
  green_chilli_small: '🌶️', // verify: Junaid
  green_chilli_big: '🌶️', // verify: Junaid
  red_chilli_fresh: '🌶️', // verify: Junaid
  lemon: '🍋', // verify: Junaid
  cucumber: '🥒', // verify: Junaid
  carrot: '🥕', // verify: Junaid
  radish: null, // verify: Junaid (no radish emoji)
  turnip: null, // verify: Junaid
  beetroot: null, // verify: Junaid
  cauliflower: null, // verify: Junaid (🥦 is broccoli)
  cabbage: '🥬', // verify: Junaid
  okra: null, // verify: Junaid
  brinjal: '🍆', // verify: Junaid
  bottle_gourd: null, // verify: Junaid
  bitter_gourd: null, // verify: Junaid
  sponge_gourd: null, // verify: Junaid
  round_gourd: null, // verify: Junaid
  pumpkin: null, // verify: Junaid (🎃 is a lantern)
  taro_root: null, // verify: Junaid
  peas: '🫛', // verify: Junaid
  green_beans: '🫛', // verify: Junaid
  capsicum_green: '🫑', // verify: Junaid
  capsicum_red: null, // verify: Junaid (🫑 is green)
  capsicum_yellow: null, // verify: Junaid (🫑 is green)
  sweet_potato: '🍠', // verify: Junaid
  lotus_stem: null, // verify: Junaid
  corn: '🌽', // verify: Junaid
  coriander: '🌿', // verify: Junaid
  mint: '🌿', // verify: Junaid
  curry_leaves: '🌿', // verify: Junaid
  spinach: '🥬', // verify: Junaid
  mustard_greens: '🥬', // verify: Junaid
  fenugreek: '🌿', // verify: Junaid
  dill: '🌿', // verify: Junaid
  spring_onion: null, // verify: Junaid
  lettuce: '🥬', // verify: Junaid
  banana: '🍌', // verify: Junaid
  apple_kala_kulu: '🍎', // verify: Junaid
  apple_gala: '🍎', // verify: Junaid
  apple_golden: '🍏', // verify: Junaid
  apple_ambri: '🍎', // verify: Junaid
  mango_sindhri: '🥭', // verify: Junaid
  mango_chaunsa: '🥭', // verify: Junaid
  mango_anwar_ratol: '🥭', // verify: Junaid
  mango_langra: '🥭', // verify: Junaid
  mango_dusehri: '🥭', // verify: Junaid
  kinnow: '🍊', // verify: Junaid
  malta: '🍊', // verify: Junaid
  sweet_lime: '🍋', // verify: Junaid
  grapefruit: '🍊', // verify: Junaid
  guava: null, // verify: Junaid
  pomegranate: null, // verify: Junaid
  pomegranate_kandhari: null, // verify: Junaid
  grapes_green: '🍇', // verify: Junaid
  grapes_black: '🍇', // verify: Junaid
  watermelon: '🍉', // verify: Junaid
  melon: '🍈', // verify: Junaid
  papaya: null, // verify: Junaid
  pear: '🍐', // verify: Junaid
  peach: '🍑', // verify: Junaid
  plum: null, // verify: Junaid
  apricot: null, // verify: Junaid
  cherry: '🍒', // verify: Junaid
  lychee: null, // verify: Junaid
  strawberry: '🍓', // verify: Junaid
  persimmon: null, // verify: Junaid
  chikoo: null, // verify: Junaid
  custard_apple: null, // verify: Junaid
  jujube: null, // verify: Junaid
  falsa: null, // verify: Junaid
  jamun: null, // verify: Junaid
  loquat: null, // verify: Junaid
  fig: null, // verify: Junaid
  coconut: '🥥', // verify: Junaid
  pineapple: '🍍', // verify: Junaid
  kiwi: '🥝', // verify: Junaid
};

interface Options {
  group?: string;
  foc?: boolean;
  seasonal?: boolean;
}

function item(
  category: PresetCategory,
  key: string,
  en: string,
  ur: string,
  unit: ProductUnit,
  roman: readonly string[],
  options: Options = {},
): ProducePreset {
  return {
    key,
    category,
    group: options.group ?? key,
    en,
    ur,
    roman,
    unit,
    focDefault: options.foc ?? false,
    seasonal: options.seasonal ?? false,
    icon: PRESET_ICONS[key] ?? null,
  };
}

const veg = (...args: Parameters<typeof partial>) => partial(...args)('vegetables');
const green = (...args: Parameters<typeof partial>) => partial(...args)('greens');
const fruit = (...args: Parameters<typeof partial>) => partial(...args)('fruits');
function partial(
  key: string,
  en: string,
  ur: string,
  unit: ProductUnit,
  roman: readonly string[],
  options?: Options,
) {
  return (category: PresetCategory) => item(category, key, en, ur, unit, roman, options);
}

export const FRESH_PRODUCE: readonly ProducePreset[] = [
  // --- Vegetables (34) ---
  veg('potato', 'Potato', 'آلو', 'kg', ['aloo', 'aalu', 'alu', 'aaloo'], { group: 'potato' }), // verify: Junaid
  veg('potato_red', 'Potato (red)', 'لال آلو', 'kg', ['lal aloo', 'laal aalu', 'red aloo'], {
    group: 'potato',
  }), // verify: Junaid
  veg('onion_red', 'Onion (red)', 'پیاز', 'kg', ['pyaz', 'piyaz', 'pyaaz', 'piaz'], {
    group: 'onion',
  }), // verify: Junaid
  veg('onion_white', 'Onion (white)', 'سفید پیاز', 'kg', ['safaid pyaz', 'safed piyaz'], {
    group: 'onion',
  }), // verify: Junaid
  veg('tomato', 'Tomato', 'ٹماٹر', 'kg', ['tamatar', 'tamater', 'timatar']), // verify: Junaid
  veg('garlic', 'Garlic', 'لہسن', 'kg', ['lehsan', 'lahsan', 'lehson']), // verify: Junaid
  veg('ginger', 'Ginger', 'ادرک', 'kg', ['adrak', 'adrik']), // verify: Junaid
  veg(
    'green_chilli_small',
    'Green chilli (small)',
    'ہری مرچ',
    'kg',
    ['hari mirch', 'hari mirchi', 'mirch'],
    { group: 'chilli', foc: true },
  ), // verify: Junaid
  veg(
    'green_chilli_big',
    'Green chilli (big)',
    'موٹی ہری مرچ',
    'kg',
    ['moti hari mirch', 'moti mirch'],
    { group: 'chilli' },
  ), // verify: Junaid
  veg('red_chilli_fresh', 'Red chilli (fresh)', 'لال مرچ', 'kg', ['lal mirch', 'laal mirch'], {
    group: 'chilli',
  }), // verify: Junaid
  veg('lemon', 'Lemon', 'لیموں', 'kg', ['nimbu', 'lemu', 'limu', 'leemu']), // verify: Junaid
  veg('cucumber', 'Cucumber', 'کھیرا', 'kg', ['khira', 'kheera']), // verify: Junaid
  veg('carrot', 'Carrot', 'گاجر', 'kg', ['gajar', 'gaajar']), // verify: Junaid
  veg('radish', 'Radish', 'مولی', 'kg', ['mooli', 'muli']), // verify: Junaid
  veg('turnip', 'Turnip', 'شلجم', 'kg', ['shaljam', 'shalgam'], { seasonal: true }), // verify: Junaid
  veg('beetroot', 'Beetroot', 'چقندر', 'kg', ['chukandar', 'chakandar']), // verify: Junaid
  veg('cauliflower', 'Cauliflower', 'پھول گوبھی', 'kg', ['phool gobi', 'phool gobhi', 'gobi']), // verify: Junaid
  veg('cabbage', 'Cabbage', 'بند گوبھی', 'kg', ['band gobi', 'band gobhi', 'patta gobi']), // verify: Junaid
  veg('okra', 'Okra', 'بھنڈی', 'kg', ['bhindi', 'bhindee', 'lady finger'], { seasonal: true }), // verify: Junaid
  veg('brinjal', 'Brinjal', 'بینگن', 'kg', ['baingan', 'bengan', 'began', 'eggplant']), // verify: Junaid
  veg('bottle_gourd', 'Bottle gourd', 'لوکی', 'kg', ['loki', 'lauki', 'kaddu']), // verify: Junaid
  veg('bitter_gourd', 'Bitter gourd', 'کریلا', 'kg', ['karela', 'kareela']), // verify: Junaid
  veg('sponge_gourd', 'Sponge gourd', 'توری', 'kg', ['tori', 'toori', 'turai'], { seasonal: true }), // verify: Junaid
  veg('round_gourd', 'Round gourd', 'ٹینڈے', 'kg', ['tinde', 'tinday', 'tinda'], {
    seasonal: true,
  }), // verify: Junaid
  veg('pumpkin', 'Pumpkin', 'حلوہ کدو', 'kg', ['halwa kaddu', 'kaddu', 'kadu']), // verify: Junaid
  veg('taro_root', 'Taro root', 'اروی', 'kg', ['arvi', 'arwi']), // verify: Junaid
  veg('peas', 'Peas', 'مٹر', 'kg', ['matar', 'mattar'], { seasonal: true }), // verify: Junaid
  veg('green_beans', 'Green beans', 'پھلیاں', 'kg', ['phaliyan', 'phali', 'beans']), // verify: Junaid
  veg('capsicum_green', 'Capsicum (green)', 'شملہ مرچ', 'kg', ['shimla mirch', 'shimla'], {
    group: 'capsicum',
  }), // verify: Junaid
  veg('capsicum_red', 'Capsicum (red)', 'لال شملہ مرچ', 'kg', ['lal shimla mirch', 'red shimla'], {
    group: 'capsicum',
  }), // verify: Junaid
  veg(
    'capsicum_yellow',
    'Capsicum (yellow)',
    'پیلی شملہ مرچ',
    'kg',
    ['peeli shimla mirch', 'yellow shimla'],
    { group: 'capsicum' },
  ), // verify: Junaid
  veg('sweet_potato', 'Sweet potato', 'شکرقندی', 'kg', ['shakarkandi', 'shakar kandi'], {
    seasonal: true,
  }), // verify: Junaid
  veg('lotus_stem', 'Lotus stem', 'بھے', 'kg', ['bhe', 'bhay', 'kamal kakri']), // verify: Junaid
  veg('corn', 'Corn on the cob', 'چھلی', 'piece', ['chali', 'chhalli', 'bhutta', 'makai'], {
    seasonal: true,
  }), // verify: Junaid

  // --- Greens & herbs (9) ---
  green('coriander', 'Coriander', 'دھنیا', 'bundle', ['dhania', 'dhaniya'], { foc: true }), // verify: Junaid
  green('mint', 'Mint', 'پودینہ', 'bundle', ['podina', 'pudina'], { foc: true }), // verify: Junaid
  green('curry_leaves', 'Curry leaves', 'کڑی پتہ', 'bundle', ['kari patta', 'curry patta'], {
    foc: true,
  }), // verify: Junaid
  green('spinach', 'Spinach', 'پالک', 'kg', ['palak']), // verify: Junaid
  green(
    'mustard_greens',
    'Mustard greens',
    'سرسوں کا ساگ',
    'kg',
    ['sarson ka saag', 'saag', 'sarson'],
    { seasonal: true },
  ), // verify: Junaid
  green('fenugreek', 'Fenugreek leaves', 'میتھی', 'bundle', ['methi', 'meethi'], {
    seasonal: true,
  }), // verify: Junaid
  green('dill', 'Dill', 'سویا', 'bundle', ['soya', 'sowa'], { seasonal: true }), // verify: Junaid
  green('spring_onion', 'Spring onion', 'ہرا پیاز', 'bundle', ['hara pyaz', 'hari piyaz']), // verify: Junaid
  green('lettuce', 'Lettuce', 'سلاد پتہ', 'piece', ['salad patta', 'salaad']), // verify: Junaid

  // --- Fruits (40) ---
  fruit('banana', 'Banana', 'کیلا', 'dozen', ['kela', 'kaila', 'kele']), // verify: Junaid
  fruit(
    'apple_kala_kulu',
    'Apple (Kala Kulu)',
    'سیب کالا کولو',
    'kg',
    ['saib kala kulu', 'seb kala kolu'],
    { group: 'apple' },
  ), // verify: Junaid
  fruit('apple_gala', 'Apple (Gala)', 'سیب گالا', 'kg', ['saib gala', 'seb gala'], {
    group: 'apple',
  }), // verify: Junaid
  fruit('apple_golden', 'Apple (Golden)', 'سیب گولڈن', 'kg', ['saib golden', 'seb golden'], {
    group: 'apple',
  }), // verify: Junaid
  fruit('apple_ambri', 'Apple (Ambri)', 'سیب امبری', 'kg', ['saib ambri', 'seb ambri'], {
    group: 'apple',
  }), // verify: Junaid
  fruit('mango_sindhri', 'Mango (Sindhri)', 'آم سندھڑی', 'kg', ['aam sindhri', 'sindhri'], {
    group: 'mango',
    seasonal: true,
  }), // verify: Junaid
  fruit(
    'mango_chaunsa',
    'Mango (Chaunsa)',
    'آم چونسہ',
    'kg',
    ['aam chaunsa', 'chaunsa', 'chonsa'],
    { group: 'mango', seasonal: true },
  ), // verify: Junaid
  fruit(
    'mango_anwar_ratol',
    'Mango (Anwar Ratol)',
    'آم انور رٹول',
    'kg',
    ['aam anwar ratol', 'anwar ratol', 'anwar retol'],
    { group: 'mango', seasonal: true },
  ), // verify: Junaid
  fruit('mango_langra', 'Mango (Langra)', 'آم لنگڑا', 'kg', ['aam langra', 'langra'], {
    group: 'mango',
    seasonal: true,
  }), // verify: Junaid
  fruit(
    'mango_dusehri',
    'Mango (Dusehri)',
    'آم دسہری',
    'kg',
    ['aam dusehri', 'dusehri', 'dasehri'],
    { group: 'mango', seasonal: true },
  ), // verify: Junaid
  fruit('kinnow', 'Kinnow', 'کینو', 'dozen', ['kinno', 'keenu', 'kinu'], { seasonal: true }), // verify: Junaid
  fruit('malta', 'Orange (malta)', 'مالٹا', 'dozen', ['malta', 'maalta'], { seasonal: true }), // verify: Junaid
  fruit('sweet_lime', 'Sweet lime', 'موسمی', 'dozen', ['mosambi', 'mausami', 'musammi'], {
    seasonal: true,
  }), // verify: Junaid
  fruit('grapefruit', 'Grapefruit', 'چکوترا', 'piece', ['chakotra', 'chakotara'], {
    seasonal: true,
  }), // verify: Junaid
  fruit('guava', 'Guava', 'امرود', 'kg', ['amrood', 'amrud'], { seasonal: true }), // verify: Junaid
  fruit('pomegranate', 'Pomegranate', 'انار', 'kg', ['anar', 'anaar'], { group: 'pomegranate' }), // verify: Junaid
  fruit(
    'pomegranate_kandhari',
    'Pomegranate (Kandhari)',
    'قندھاری انار',
    'kg',
    ['kandhari anar', 'qandhari anaar'],
    { group: 'pomegranate' },
  ), // verify: Junaid
  fruit('grapes_green', 'Grapes (green)', 'سبز انگور', 'kg', ['sabz angoor', 'angoor', 'angur'], {
    group: 'grapes',
    seasonal: true,
  }), // verify: Junaid
  fruit('grapes_black', 'Grapes (black)', 'کالے انگور', 'kg', ['kalay angoor', 'kale angur'], {
    group: 'grapes',
    seasonal: true,
  }), // verify: Junaid
  fruit('watermelon', 'Watermelon', 'تربوز', 'kg', ['tarbooz', 'tarbuz'], { seasonal: true }), // verify: Junaid
  fruit('melon', 'Melon', 'خربوزہ', 'kg', ['kharbooza', 'kharbuza', 'garma'], { seasonal: true }), // verify: Junaid
  fruit('papaya', 'Papaya', 'پپیتا', 'kg', ['papita', 'papeeta']), // verify: Junaid
  fruit('pear', 'Pear', 'ناشپاتی', 'kg', ['nashpati', 'nashpaati'], { seasonal: true }), // verify: Junaid
  fruit('peach', 'Peach', 'آڑو', 'kg', ['aaru', 'aru', 'arhu'], { seasonal: true }), // verify: Junaid
  fruit('plum', 'Plum', 'آلو بخارا', 'kg', ['aloo bukhara', 'alu bukhara'], { seasonal: true }), // verify: Junaid
  fruit('apricot', 'Apricot', 'خوبانی', 'kg', ['khubani', 'khoobani'], { seasonal: true }), // verify: Junaid
  fruit('cherry', 'Cherry', 'چیری', 'kg', ['cheri', 'chery'], { seasonal: true }), // verify: Junaid
  fruit('lychee', 'Lychee', 'لیچی', 'kg', ['lichi', 'leechi'], { seasonal: true }), // verify: Junaid
  fruit('strawberry', 'Strawberry', 'اسٹرابیری', 'kg', ['strawberi', 'istrabery'], {
    seasonal: true,
  }), // verify: Junaid
  fruit('persimmon', 'Persimmon', 'جاپانی پھل', 'kg', ['japani phal', 'japani fruit'], {
    seasonal: true,
  }), // verify: Junaid
  fruit('chikoo', 'Chikoo', 'چیکو', 'kg', ['cheeku', 'chiku', 'sapodilla'], { seasonal: true }), // verify: Junaid
  fruit('custard_apple', 'Custard apple', 'شریفہ', 'kg', ['sharifa', 'shareefa'], {
    seasonal: true,
  }), // verify: Junaid
  fruit('jujube', 'Jujube (ber)', 'بیر', 'kg', ['ber', 'bair'], { seasonal: true }), // verify: Junaid
  fruit('falsa', 'Falsa', 'فالسہ', 'kg', ['falsa', 'phalsa'], { seasonal: true }), // verify: Junaid
  fruit('jamun', 'Jamun', 'جامن', 'kg', ['jaman', 'jamun'], { seasonal: true }), // verify: Junaid
  fruit('loquat', 'Loquat', 'لوکاٹ', 'kg', ['lokat', 'lokaat'], { seasonal: true }), // verify: Junaid
  fruit('fig', 'Fig (fresh)', 'انجیر', 'kg', ['anjeer', 'anjir'], { seasonal: true }), // verify: Junaid
  fruit('coconut', 'Coconut', 'ناریل', 'piece', ['nariyal', 'naryal', 'khopra']), // verify: Junaid
  fruit('pineapple', 'Pineapple', 'انناس', 'piece', ['ananas', 'annanas']), // verify: Junaid
  fruit('kiwi', 'Kiwi', 'کیوی', 'kg', ['kivi', 'keevi']), // verify: Junaid
];

/** Picker order: by category, varieties together, seasonal items after the year-round ones. */
export function presetsForPicker(): ProducePreset[] {
  const order = (c: PresetCategory) => PRESET_CATEGORIES[c].sort;
  const firstIndex = new Map<string, number>();
  FRESH_PRODUCE.forEach((p, i) => {
    if (!firstIndex.has(p.group)) firstIndex.set(p.group, i);
  });
  return [...FRESH_PRODUCE].sort(
    (a, b) =>
      order(a.category) - order(b.category) ||
      Number(a.seasonal) - Number(b.seasonal) ||
      firstIndex.get(a.group)! - firstIndex.get(b.group)! ||
      FRESH_PRODUCE.indexOf(a) - FRESH_PRODUCE.indexOf(b),
  );
}
