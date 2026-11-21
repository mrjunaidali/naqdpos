import { describe, expect, it } from 'vitest';
import { CustomerRowSchema, KhataEntryRowSchema } from './api/schemas.ts';
import { makeLine, type CartLine } from './cart.ts';
import {
  buildKhataAdjustment,
  buildKhataReceipt,
  isOverdue,
  khataBalance,
  khataReceiptText,
  rupeesText,
  runningBalance,
  splitWithKhata,
  telLink,
  waLink,
  type KhataEntryRow,
} from './khata.ts';
import { buildSale } from './sale.ts';

const SHOP = '019a9b8e-0000-7000-8000-000000000001';
const STAFF = '019a9b8e-0000-7000-8000-000000000002';
const CUSTOMER = '019a9b8e-0000-5000-8000-000000000003';
const ctx = { shopId: SHOP, deviceId: null, staffId: STAFF, now: new Date('2026-11-22T10:00:00Z') };

let n = 0;
const e = (
  type: KhataEntryRow['type'],
  amount: number,
  date: string,
): Pick<KhataEntryRow, 'id' | 'type' | 'business_date' | 'created_at' | 'amount_paisa'> => ({
  id: `019a9b8e-0000-7000-8000-${String(++n).padStart(12, '0')}`,
  type,
  amount_paisa: amount,
  business_date: date,
  created_at: `${date}T10:00:00.000Z`,
});

describe('balance and running balance', () => {
  it('balance is the sum; running balance follows ledger order', () => {
    const entries = [
      e('payment', -50000, '2026-11-10'),
      e('credit_sale', 120000, '2026-11-01'),
      e('credit_sale', 30000, '2026-11-15'),
      e('adjustment', -500, '2026-11-15'),
    ];
    expect(khataBalance(entries)).toBe(99500);
    expect(runningBalance(entries).map((r) => [r.business_date, r.balance_paisa])).toEqual([
      ['2026-11-01', 120000],
      ['2026-11-10', 70000],
      ['2026-11-15', 100000],
      ['2026-11-15', 99500],
    ]);
    expect(khataBalance([])).toBe(0);
  });
});

describe('overdue', () => {
  const now = new Date('2026-11-22T10:00:00Z'); // business date 22 Nov

  it('balance > 0 and the last payment N or more days ago', () => {
    const paid = [e('credit_sale', 10000, '2026-10-01'), e('payment', -1000, '2026-10-23')];
    expect(isOverdue(paid, now, 30)).toBe(true); // 30 days
    expect(isOverdue(paid, now, 31)).toBe(false);
    expect(isOverdue([...paid, e('payment', -1000, '2026-11-20')], now, 30)).toBe(false);
  });

  it('never paid: counts from the first entry; nothing owed is never overdue', () => {
    expect(isOverdue([e('credit_sale', 10000, '2026-10-01')], now, 30)).toBe(true);
    expect(isOverdue([e('credit_sale', 10000, '2026-11-01')], now, 30)).toBe(false);
    const settled = [e('credit_sale', 10000, '2026-01-01'), e('payment', -10000, '2026-01-02')];
    expect(isOverdue(settled, now, 30)).toBe(false);
    expect(isOverdue([], now)).toBe(false);
  });
});

describe('a bill split with khata', () => {
  it('khata takes what payments leave', () => {
    expect(splitWithKhata(21500, [])).toEqual({ khata_paisa: 21500 });
    expect(splitWithKhata(21500, [{ amount_paisa: 10000 }])).toEqual({ khata_paisa: 11500 });
    expect(splitWithKhata(21500, [{ amount_paisa: 21500 }])).toEqual({ khata_paisa: 0 });
    expect(splitWithKhata(21500, [{ amount_paisa: 30000 }])).toEqual({ error: 'overpaid' });
  });

  const cart = [
    makeLine(
      {
        product_id: 'p',
        name: 'Tomato',
        name_ur: null,
        unit: 'kg',
        icon: null,
        unit_price_paisa: 16500,
      },
      1300,
    ) as CartLine,
  ]; // Rs 214.50 → Rs 215
  const sale = {
    ...ctx,
    deviceId: '019a9b8e-0000-7000-8000-0000000000d1',
    role: 'cashier' as const,
    limitPct: 10,
    receiptNo: 'A1-000001',
  };
  const cash = (amount: number) => [{ method_code: 'cash', amount_paisa: amount, reference: null }];

  it('buildSale: fully and partly on khata; sums match the total', () => {
    const all = buildSale(cart, [], { ...sale, customerId: CUSTOMER, khataPaisa: 21500 });
    if ('error' in all) throw new Error(all.error);
    expect(all.payments).toEqual([]);
    expect(all.khata).toMatchObject({
      type: 'credit_sale',
      amount_paisa: 21500,
      sale_id: all.sale.id,
      customer_id: CUSTOMER,
    });
    expect(all.sale.customer_id).toBe(CUSTOMER);
    expect(KhataEntryRowSchema.safeParse(all.khata).error?.issues ?? []).toEqual([]);

    const part = buildSale(cart, cash(10000), { ...sale, customerId: CUSTOMER, khataPaisa: 11500 });
    if ('error' in part) throw new Error(part.error);
    expect(part.payments[0]!.amount_paisa + part.khata!.amount_paisa).toBe(part.sale.total_paisa);
    expect(part.payments[0]!.customer_id).toBe(CUSTOMER);
  });

  it('buildSale: khata needs a customer and must close the bill exactly', () => {
    expect(buildSale(cart, [], { ...sale, khataPaisa: 21500 })).toEqual({
      error: 'khata_needs_customer',
    });
    expect(
      buildSale(cart, cash(10000), { ...sale, customerId: CUSTOMER, khataPaisa: 1000 }),
    ).toEqual({ error: 'not_paid' });
    expect(
      buildSale(cart, cash(10000), { ...sale, customerId: CUSTOMER, khataPaisa: 20000 }),
    ).toEqual({ error: 'overpaid' });
    // A customer without khata: no entry.
    const plain = buildSale(cart, cash(21500), { ...sale, customerId: CUSTOMER });
    if ('error' in plain) throw new Error(plain.error);
    expect(plain.khata).toBeNull();
  });
});

describe('receive payment and adjustments', () => {
  it('a receipt is a khata_receipt payment and the matching negative entry', () => {
    const r = buildKhataReceipt(
      { ...ctx, customerId: CUSTOMER, methodCode: 'jazzcash', reference: ' TX9 ' },
      50000,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.payment).toMatchObject({
      kind: 'khata_receipt',
      customer_id: CUSTOMER,
      sale_id: null,
      amount_paisa: 50000,
      reference: 'TX9',
    });
    expect(r.entry).toMatchObject({
      type: 'payment',
      amount_paisa: -50000,
      payment_id: r.payment.id,
    });
    expect(buildKhataReceipt({ ...ctx, customerId: CUSTOMER, methodCode: 'cash' }, 0)).toEqual({
      error: 'bad_amount',
    });
  });

  it('adjustments: owner only, note required, never 0', () => {
    const owner = { ...ctx, customerId: CUSTOMER, role: 'owner' as const };
    expect(buildKhataAdjustment(owner, -2000, ' old balance fixed ')).toMatchObject({
      type: 'adjustment',
      amount_paisa: -2000,
      note: 'old balance fixed',
    });
    expect(buildKhataAdjustment({ ...owner, role: 'cashier' }, 2000, 'x')).toEqual({
      error: 'forbidden',
    });
    expect(buildKhataAdjustment(owner, 2000, '  ')).toEqual({ error: 'note_required' });
    expect(buildKhataAdjustment(owner, 0, 'x')).toEqual({ error: 'bad_amount' });
    expect(buildKhataAdjustment(owner, 1, 'x'.repeat(201))).toEqual({ error: 'note_too_long' });
  });
});

describe('sharing', () => {
  it('receipt text in English and Urdu, with grouped rupees', () => {
    expect(rupeesText(120000)).toBe('1,200');
    expect(rupeesText(123456789)).toBe('1,234,567.89');
    expect(khataReceiptText('en', 50000, 120000, 'Ali Fruits')).toBe(
      'Rs 500 received. New balance Rs 1,200. — Ali Fruits',
    );
    expect(khataReceiptText('ur', 50000, 120000, 'Ali Fruits')).toBe(
      '500 روپے وصول ہوئے۔ نیا بقایا 1,200 روپے۔ — Ali Fruits',
    );
  });

  it('wa.me and tel links', () => {
    expect(waLink('+923001234567', 'Rs 500 received.')).toBe(
      'https://wa.me/923001234567?text=Rs%20500%20received.',
    );
    expect(waLink('+923001234567')).toBe('https://wa.me/923001234567');
    expect(telLink('+923001234567')).toBe('tel:+923001234567');
  });

  it('customer row schema keeps the mobile in E.164', () => {
    const row = {
      id: CUSTOMER,
      shop_id: SHOP,
      mobile: '+923001234567',
      name: 'Ali',
      address: null,
      credit_limit_paisa: null,
      whatsapp_opt_in: false,
      device_id: null,
      created_at: '',
      updated_at: '',
      deleted_at: null,
      server_seq: null,
    };
    expect(CustomerRowSchema.safeParse(row).success).toBe(true);
    expect(CustomerRowSchema.safeParse({ ...row, mobile: '03001234567' }).success).toBe(false);
  });
});
