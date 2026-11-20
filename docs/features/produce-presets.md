# Feature: Preloaded fresh produce list

Status: **in backlog** as **US072** (R1, build phase 6 with products). Schema approved (Urdu + English names in the same row, recorded in `docs/architecture.md` §3).

## Goal

Fruit & veg owners should not type potato, onion, tomato… on every new shop. The app ships a built-in list of 83 common items (34 vegetables, 9 greens & herbs, 40 fruits), including common varieties. The owner ticks what they sell, enters today's rate, and the products are created.

Data lives in `packages/core/src/presets/freshProduce.ts` (English, Urdu, Roman Urdu search names, default unit, variety group, FOC default, seasonal flag).

## Rules

- **Pick, don't dump.** Presets are shown as a checklist in owner onboarding (shop type `fruit_veg`) and later under Products → "Add from list". Nothing is created until the owner picks it.
- **Both names in one row.** A picked preset becomes a `products` row with `name` = English and `name_ur` = Urdu. The UI shows the current language and falls back to the other. Owners can edit either name. Only English and Urdu (Pakistan only).
- **Varieties are separate products.** E.g. Green chilli (small), Green chilli (big), Red chilli (fresh); Mango Sindhri / Chaunsa / Anwar Ratol. Presets with the same `group` are shown together in the picker. Owners can also add their own varieties.
- **No preset prices.** Rates follow the daily mandi rate. The picker asks for today's sale rate per ticked item (optional). Blank rate → `sale_price_paisa = 0` and the sale screen asks for the rate the first time it is sold.
- Created products are ordinary `products` rows (UUIDv7 on device, offline, via outbox).
- **Duplicates:** a preset is shown as "Added" if the shop already has an active product with the same English name (case-insensitive). No extra column.
- `focDefault` items (small green chilli, coriander, mint, curry leaves) are flagged as usual FOC items; the owner still sets the actual FOC rule.
- `seasonal` only affects sort order in the picker. It never blocks a sale.
- Search matches English, Urdu and Roman Urdu spellings (`aloo`, `aalu`, `pyaz`, `tamatar`, `chaunsa`…).
- Three categories are created on demand with both names: Vegetables / سبزیاں, Greens & herbs / ساگ اور ہرے مصالحے, Fruits / پھل.

## List

Urdu to be verified by Junaid.

### Vegetables (34)
| English | Urdu | Unit | Notes |
| --- | --- | --- | --- |
| Potato | آلو | kg | |
| Potato (red) | لال آلو | kg | |
| Onion (red) | پیاز | kg | |
| Onion (white) | سفید پیاز | kg | |
| Tomato | ٹماٹر | kg | |
| Garlic | لہسن | kg | |
| Ginger | ادرک | kg | |
| Green chilli (small) | ہری مرچ | kg | FOC |
| Green chilli (big) | موٹی ہری مرچ | kg | |
| Red chilli (fresh) | لال مرچ | kg | |
| Lemon | لیموں | kg | |
| Cucumber | کھیرا | kg | |
| Carrot | گاجر | kg | |
| Radish | مولی | kg | |
| Turnip | شلجم | kg | seasonal |
| Beetroot | چقندر | kg | |
| Cauliflower | پھول گوبھی | kg | |
| Cabbage | بند گوبھی | kg | |
| Okra | بھنڈی | kg | seasonal |
| Brinjal | بینگن | kg | |
| Bottle gourd | لوکی | kg | |
| Bitter gourd | کریلا | kg | |
| Sponge gourd | توری | kg | seasonal |
| Round gourd | ٹینڈے | kg | seasonal |
| Pumpkin | حلوہ کدو | kg | |
| Taro root | اروی | kg | |
| Peas | مٹر | kg | seasonal |
| Green beans | پھلیاں | kg | |
| Capsicum (green) | شملہ مرچ | kg | |
| Capsicum (red) | لال شملہ مرچ | kg | |
| Capsicum (yellow) | پیلی شملہ مرچ | kg | |
| Sweet potato | شکرقندی | kg | seasonal |
| Lotus stem | بھے | kg | |
| Corn on the cob | چھلی | piece | seasonal |

### Greens & herbs (9)
| English | Urdu | Unit | Notes |
| --- | --- | --- | --- |
| Coriander | دھنیا | bundle | FOC |
| Mint | پودینہ | bundle | FOC |
| Curry leaves | کڑی پتہ | bundle | FOC |
| Spinach | پالک | kg | |
| Mustard greens | سرسوں کا ساگ | kg | seasonal |
| Fenugreek leaves | میتھی | bundle | seasonal |
| Dill | سویا | bundle | seasonal |
| Spring onion | ہرا پیاز | bundle | |
| Lettuce | سلاد پتہ | piece | |

### Fruits (40)
| English | Urdu | Unit | Notes |
| --- | --- | --- | --- |
| Banana | کیلا | dozen | |
| Apple (Kala Kulu) | سیب کالا کولو | kg | |
| Apple (Gala) | سیب گالا | kg | |
| Apple (Golden) | سیب گولڈن | kg | |
| Apple (Ambri) | سیب امبری | kg | |
| Mango (Sindhri) | آم سندھڑی | kg | seasonal |
| Mango (Chaunsa) | آم چونسہ | kg | seasonal |
| Mango (Anwar Ratol) | آم انور رٹول | kg | seasonal |
| Mango (Langra) | آم لنگڑا | kg | seasonal |
| Mango (Dusehri) | آم دسہری | kg | seasonal |
| Kinnow | کینو | dozen | seasonal |
| Orange (malta) | مالٹا | dozen | seasonal |
| Sweet lime | موسمی | dozen | seasonal |
| Grapefruit | چکوترا | piece | seasonal |
| Guava | امرود | kg | seasonal |
| Pomegranate | انار | kg | |
| Pomegranate (Kandhari) | قندھاری انار | kg | |
| Grapes (green) | سبز انگور | kg | seasonal |
| Grapes (black) | کالے انگور | kg | seasonal |
| Watermelon | تربوز | kg | seasonal |
| Melon | خربوزہ | kg | seasonal |
| Papaya | پپیتا | kg | |
| Pear | ناشپاتی | kg | seasonal |
| Peach | آڑو | kg | seasonal |
| Plum | آلو بخارا | kg | seasonal |
| Apricot | خوبانی | kg | seasonal |
| Cherry | چیری | kg | seasonal |
| Lychee | لیچی | kg | seasonal |
| Strawberry | اسٹرابیری | kg | seasonal |
| Persimmon | جاپانی پھل | kg | seasonal |
| Chikoo | چیکو | kg | seasonal |
| Custard apple | شریفہ | kg | seasonal |
| Jujube (ber) | بیر | kg | seasonal |
| Falsa | فالسہ | kg | seasonal |
| Jamun | جامن | kg | seasonal |
| Loquat | لوکاٹ | kg | seasonal |
| Fig (fresh) | انجیر | kg | seasonal |
| Coconut | ناریل | piece | |
| Pineapple | انناس | piece | |
| Kiwi | کیوی | kg | |

## Acceptance criteria (draft)

- Given a new `fruit_veg` shop, onboarding shows the preset checklist grouped by category (varieties together) with search; ticking items and tapping Save creates one `products` row per item, with `name` and `name_ur`, plus the needed categories, in one Dexie transaction with outbox entries, offline.
- Rates entered in the picker become `sale_price_paisa` and a `price_history` row; blank rate → 0 and a rate prompt on first sale.
- Presets whose English name already exists as an active product show "Added" and are not created twice.
- Searching "aalu", "آلو" or "potato" finds Potato; "chaunsa" finds Mango (Chaunsa).
- With the UI in Urdu, product names show `name_ur`; if empty, `name`.

## Out of scope

Grocery/meat presets (same pattern later), images, barcode items (`global_catalogue`, Release 2), auto-updating mandi rates.
