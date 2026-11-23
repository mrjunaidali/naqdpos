import { describe, expect, it } from 'vitest';
import { chunkBytes, escposRaster, toMonoRaster } from './escpos.ts';
import {
  receiptDateTime,
  receiptFor,
  receiptText,
  withLogo,
  type ReceiptDoc,
  type ReceiptInput,
} from './receipt.ts';
import type { PaymentRow, SaleLineRow, SaleRow } from './sale.ts';
import { validateShopProfile } from './shopProfile.ts';

// Fake labels: the app passes i18next fixed to 'en' / 'ur'.
const EN: Record<string, string> = {
  'receipt.rs': 'Rs {{amount}}',
  'receipt.qtyRate': '{{qty}} × {{rate}}',
  'receipt.receiptNo': 'Receipt',
  'receipt.date': 'Date',
  'receipt.cashier': 'Cashier',
  'receipt.customer': 'Customer',
  'receipt.foc': 'FOC',
  'receipt.focValue': 'Free (value)',
  'receipt.discount': 'Discount',
  'receipt.subtotal': 'Subtotal',
  'receipt.itemDiscounts': 'Item discounts',
  'receipt.billDiscount': 'Bill discount',
  'receipt.rounding': 'Rounding',
  'receipt.total': 'Total',
  'receipt.change': 'Change',
  'receipt.onKhata': 'On khata',
  'receipt.khataBalance': 'Khata balance',
  'unit.kg': 'kg',
  'unit.g': 'g',
  'unit.bundle': 'bundle',
};
const UR: Record<string, string> = {
  ...Object.fromEntries(Object.keys(EN).map((k) => [k, `ur:${k}`])),
  'receipt.rs': '{{amount}} روپے',
  'receipt.total': 'کل',
  'receipt.qtyRate': '{{qty}} × {{rate}}',
  'unit.kg': 'کلو',
  'unit.g': 'گرام',
  'unit.bundle': 'گڈی',
};
const fn =
  (dict: Record<string, string>) =>
  (key: string, vars: Record<string, string> = {}) =>
    (dict[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, v: string) => vars[v] ?? '');

const sale: SaleRow = {
  id: 's1',
  shop_id: 'shop',
  receipt_no: 'A1-000042',
  business_date: '2026-11-22',
  staff_id: 'st',
  customer_id: 'c1',
  order_type: 'walk_in',
  source: 'walk_in',
  subtotal_paisa: 20450, // 21450 − Rs 10 line discount
  discount_paisa: 450,
  rounding_paisa: 0,
  total_paisa: 20000,
  note: null,
  discount_approved_by_staff_id: null,
  created_at: '2026-11-22T10:05:00.000Z', // 15:05 in Karachi
  device_id: null,
  server_seq: null,
};
const line = (over: Partial<SaleLineRow>): SaleLineRow => ({
  id: 'l',
  shop_id: 'shop',
  sale_id: 's1',
  product_id: 'p',
  name_snapshot: 'Tomato',
  name_ur_snapshot: 'ٹماٹر',
  unit_snapshot: 'kg',
  qty_milli: 1300,
  unit_price_paisa: 16500,
  discount_paisa: 1000,
  is_foc: false,
  by_amount: false,
  line_total_paisa: 20450,
  created_at: sale.created_at,
  device_id: null,
  server_seq: null,
  ...over,
});
const lines = [
  line({}),
  line({
    id: 'l2',
    name_snapshot: 'Coriander',
    name_ur_snapshot: 'دھنیا',
    unit_snapshot: 'bundle',
    qty_milli: 1000,
    unit_price_paisa: 4000,
    discount_paisa: 0,
    is_foc: true,
    line_total_paisa: 0,
  }),
];
const pay = (method: string, amount: number): PaymentRow => ({
  id: method,
  shop_id: 'shop',
  business_date: sale.business_date,
  kind: 'sale',
  sale_id: 's1',
  customer_id: 'c1',
  method_code: method,
  amount_paisa: amount,
  reference: null,
  staff_id: 'st',
  created_at: sale.created_at,
  device_id: null,
  server_seq: null,
});

const input = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  sale,
  lines,
  payments: [pay('cash', 10000), pay('jazzcash', 5000)],
  shop: {
    name: 'Ali Fruit',
    address: 'Main Bazaar, Lahore',
    phone: '0300 1234567',
    receipt_footer: 'Thank you!\nShukriya',
    receipt_language: 'en',
    paper_width_mm: 58,
  },
  staffName: 'Bilal',
  khata: { customerName: 'Sara', onKhataPaisa: 5000, balancePaisa: 125000 },
  changePaisa: 0,
  methodName: (code, lang) =>
    lang === 'ur' ? `ur-${code}` : code === 'cash' ? 'Cash' : 'JazzCash',
  labels: { en: fn(EN), ur: fn(UR) },
  ...over,
});

describe('receiptFor', () => {
  it('has every section in order: header, items, FOC, discounts, totals, payments, khata, footer', () => {
    const doc = receiptFor(input());
    expect(doc).toMatchObject({ language: 'en', dir: 'ltr', paperWidthMm: 58 });
    expect(receiptText(doc)).toBe(
      [
        '*Ali Fruit*',
        'Main Bazaar, Lahore',
        '0300 1234567',
        '------------------------',
        'Receipt: A1-000042',
        'Date: 22/11/2026 15:05',
        'Cashier: Bilal',
        'Customer: Sara',
        '------------------------',
        'Tomato\n  1.3 kg × Rs 165 = Rs 214.50',
        'Discount: −Rs 10',
        'Coriander\n  1 bundle × Rs 40 = FOC',
        'Free (value): Rs 40',
        '------------------------',
        'Subtotal: Rs 214.50',
        'Item discounts: −Rs 10',
        'Bill discount: −Rs 4.50',
        '*Total: Rs 200*',
        'Cash: Rs 100',
        'JazzCash: Rs 50',
        'On khata: Rs 50',
        '*Khata balance: Rs 1,250*',
        '------------------------',
        'Thank you!',
        'Shukriya',
      ].join('\n'),
    );
  });

  it('rounding and change; no customer, no footer, no subtotal when nothing changes it', () => {
    const plain = {
      ...sale,
      customer_id: null,
      subtotal_paisa: 21450,
      discount_paisa: 0,
      rounding_paisa: 50,
      total_paisa: 21500,
    };
    const text = receiptText(
      receiptFor(
        input({
          sale: plain,
          lines: [line({ discount_paisa: 0, line_total_paisa: 21450 })],
          payments: [pay('cash', 21500)],
          khata: null,
          changePaisa: 28500,
          staffName: null,
          shop: { ...input().shop, receipt_footer: null, address: null, phone: null },
        }),
      ),
    );
    expect(text).toContain('Subtotal: Rs 214.50\nRounding: +Rs 0.50\n*Total: Rs 215*');
    expect(text).toContain('Change: Rs 285');
    expect(text).not.toMatch(/Khata|Customer|Cashier/);
    expect(
      receiptText(
        receiptFor(
          input({
            sale: { ...plain, rounding_paisa: 0, total_paisa: 21450 },
            lines: [line({ discount_paisa: 0, line_total_paisa: 21450 })],
            khata: null,
          }),
        ),
      ),
    ).not.toContain('Subtotal');
  });

  it('Urdu: RTL, Urdu names, labels and money', () => {
    const doc = receiptFor(input({ shop: { ...input().shop, receipt_language: 'ur' } }));
    expect(doc.dir).toBe('rtl');
    const text = receiptText(doc);
    expect(text).toContain('ٹماٹر\n  1.3 کلو × 165 روپے = 214.50 روپے');
    expect(text).toContain('*کل: 200 روپے*');
    expect(text).toContain('ur-cash: 100 روپے');
  });

  it('both languages: "English / اردو" labels and names, money in English', () => {
    const text = receiptText(
      receiptFor(input({ shop: { ...input().shop, receipt_language: 'both' } })),
    );
    expect(text).toContain('Tomato / ٹماٹر\n  1.3 kg × Rs 165 = Rs 214.50');
    expect(text).toContain('*Total / کل: Rs 200*');
    expect(text).toContain('Cash / ur-cash: Rs 100');
  });

  it('formats the date and time in Asia/Karachi', () => {
    expect(receiptDateTime('2026-11-22T19:30:00.000Z')).toBe('23/11/2026 00:30');
  });
});

describe('shop profile', () => {
  const ok = {
    name: ' Ali Fruit ',
    address: '',
    phone: '0300 1234567',
    receiptFooter: 'Thank you!  \nShukriya',
    receiptLanguage: 'both',
    paperWidth: 80,
    expenseLimit: '2500',
  };
  it('cleans and accepts a valid profile', () => {
    expect(validateShopProfile(ok).value).toEqual({
      name: 'Ali Fruit',
      address: null,
      city: null,
      phone: '0300 1234567',
      receipt_footer: 'Thank you!\nShukriya',
      receipt_language: 'both',
      paper_width_mm: 80,
      cashier_expense_limit_paisa: 250000,
    });
  });
  it('refuses bad input', () => {
    expect(
      validateShopProfile({
        ...ok,
        name: ' ',
        phone: 'call me',
        receiptFooter: 'x'.repeat(201),
        receiptLanguage: 'fr',
        paperWidth: 72,
        expenseLimit: '-5',
      }).errors,
    ).toEqual({
      name: 'required',
      phone: 'invalid',
      receiptFooter: 'too_long',
      receiptLanguage: 'invalid',
      paperWidth: 'invalid',
      expenseLimit: 'invalid',
    });
    expect(validateShopProfile({ ...ok, name: 'x'.repeat(81) }).errors).toEqual({
      name: 'too_long',
    });
  });
});

describe('ESC/POS raster', () => {
  /** 9 × 2 pixels: row 0 black at x = 0 and x = 8; row 1 white, with a transparent black pixel. */
  function image() {
    const w = 9;
    const data = new Uint8ClampedArray(w * 2 * 4).fill(255);
    const set = (x: number, y: number, rgba: number[]) => data.set(rgba, (y * w + x) * 4);
    set(0, 0, [0, 0, 0, 255]);
    set(8, 0, [40, 40, 40, 255]);
    set(1, 1, [0, 0, 0, 0]); // transparent: does not print
    set(2, 1, [200, 200, 200, 255]); // light grey: does not print
    return { width: w, height: 2, data };
  }

  it('turns a known bitmap into the expected bytes', () => {
    const bitmap = toMonoRaster(image());
    expect(bitmap.widthBytes).toBe(2);
    expect([...bitmap.bytes]).toEqual([0x80, 0x80, 0x00, 0x00]);
    expect([...escposRaster(bitmap)]).toEqual([
      0x1b,
      0x40, // ESC @
      0x1d,
      0x76,
      0x30,
      0x00,
      0x02,
      0x00,
      0x02,
      0x00, // GS v 0, 2 bytes wide, 2 rows
      0x80,
      0x80,
      0x00,
      0x00,
      0x1b,
      0x64,
      0x04, // feed 4 lines
    ]);
  });

  it('splits tall images into bands', () => {
    const bitmap = { widthBytes: 1, height: 3, bytes: Uint8Array.from([1, 2, 3]) };
    expect([...escposRaster(bitmap, { bandHeight: 2, feedLines: 0 })]).toEqual([
      0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0, 1, 2, 0x1d, 0x76, 0x30, 0x00, 1, 0, 1, 0, 3,
      0x1b, 0x64, 0x00,
    ]);
  });

  it('chunks bytes for Bluetooth writes', () => {
    const bytes = Uint8Array.from({ length: 450 }, (_, i) => i & 0xff);
    const chunks = chunkBytes(bytes, 180);
    expect(chunks.map((c) => c.length)).toEqual([180, 180, 90]);
    expect(chunks.flatMap((c) => [...c])).toEqual([...bytes]);
    expect(chunkBytes(new Uint8Array(0), 180)).toEqual([]);
    expect(() => chunkBytes(bytes, 0)).toThrow(RangeError);
  });
});

describe('shop logo on receipts (US014)', () => {
  const doc: ReceiptDoc = {
    language: 'en',
    dir: 'ltr',
    paperWidthMm: 58,
    lines: [{ kind: 'title', text: 'Ali Fruit' }],
  };

  it('withLogo puts the logo first only when the device has one', () => {
    expect(withLogo(doc, true).lines[0]).toEqual({ kind: 'logo' });
    expect(withLogo(doc, true).lines).toHaveLength(2);
    expect(withLogo(doc, false)).toBe(doc);
  });

  it('plain text (WhatsApp) skips the logo', () => {
    expect(receiptText(withLogo(doc, true))).toBe('*Ali Fruit*');
  });
});
