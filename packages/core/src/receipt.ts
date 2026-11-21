// Receipts (US036): one structured model, rendered as plain text (WhatsApp), HTML (preview and
// browser print) and a canvas image (Bluetooth ESC/POS). Pure. Labels come from the caller in the
// shop's receipt language (not the app's), so the same receipt prints the same on every device.
import { qtyLabel } from './cart.ts';
import type { ProductUnit } from './catalogue.ts';
import { priceForQty } from './qty.ts';
import { rupeesText } from './khata.ts';
import type { PaymentRow, SaleLineRow, SaleRow } from './sale.ts';
import type { PaperWidth, ReceiptLanguage, ShopRow } from './tenancy.ts';
import { DEFAULT_TIMEZONE } from './tenancy.ts';

export type ReceiptLine =
  | { kind: 'title'; text: string }
  | { kind: 'center'; text: string }
  | { kind: 'item'; name: string; detail: string; amount: string }
  | { kind: 'pair'; label: string; value: string; strong?: boolean }
  | { kind: 'rule' };

export interface ReceiptDoc {
  language: ReceiptLanguage;
  dir: 'ltr' | 'rtl';
  paperWidthMm: PaperWidth;
  lines: ReceiptLine[];
}

/** Receipt words in one language: `receipt.<key>` and `unit.<unit>` from the app's i18n. */
export type LabelFn = (key: string, vars?: Record<string, string>) => string;

export interface ReceiptInput {
  sale: SaleRow;
  lines: readonly SaleLineRow[];
  payments: readonly PaymentRow[];
  shop: Pick<
    ShopRow,
    'name' | 'address' | 'phone' | 'receipt_footer' | 'receipt_language' | 'paper_width_mm'
  >;
  staffName: string | null;
  /** The khata part of this sale and the customer's balance after it, when a customer is attached. */
  khata: { customerName: string; onKhataPaisa: number; balancePaisa: number } | null;
  /** Change given in cash (known right after the sale; not stored). */
  changePaisa?: number;
  /** Payment method names (built-ins through i18n, custom ones by label). */
  methodName: (code: string, lang: 'en' | 'ur') => string;
  labels: { en: LabelFn; ur: LabelFn };
  timeZone?: string;
}

/** "22/11/2026 15:05" in the shop's time zone (Latin digits). */
export function receiptDateTime(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function receiptFor(input: ReceiptInput): ReceiptDoc {
  const lang = input.shop.receipt_language;
  const one = lang === 'both' ? 'en' : lang;
  /** A label in the receipt language; "both" shows "English / اردو". */
  const L = (key: string, vars?: Record<string, string>) => {
    const en = input.labels.en(key, vars);
    if (lang === 'en') return en;
    const ur = input.labels.ur(key, vars);
    return lang === 'ur' ? ur : en === ur ? en : `${en} / ${ur}`;
  };
  // Money and units in one language (amounts must read cleanly even on "both").
  const M = input.labels[one];
  const rs = (paisa: number) => M('receipt.rs', { amount: rupeesText(paisa) });
  const minus = (paisa: number) => `−${rs(paisa)}`;
  const qty = (milli: number, unit: ProductUnit) => {
    const label = qtyLabel(milli, unit);
    return `${label.amount} ${M(`unit.${label.unit}`)}`;
  };
  const method = (code: string) =>
    lang === 'both'
      ? `${input.methodName(code, 'en')} / ${input.methodName(code, 'ur')}`
      : input.methodName(code, one);

  const { sale, shop } = input;
  const out: ReceiptLine[] = [{ kind: 'title', text: shop.name }];
  if (shop.address) out.push({ kind: 'center', text: shop.address });
  if (shop.phone) out.push({ kind: 'center', text: shop.phone });
  out.push({ kind: 'rule' });
  out.push({ kind: 'pair', label: L('receipt.receiptNo'), value: sale.receipt_no });
  out.push({
    kind: 'pair',
    label: L('receipt.date'),
    value: receiptDateTime(sale.created_at, input.timeZone),
  });
  if (input.staffName)
    out.push({ kind: 'pair', label: L('receipt.cashier'), value: input.staffName });
  if (input.khata) {
    out.push({ kind: 'pair', label: L('receipt.customer'), value: input.khata.customerName });
  }
  out.push({ kind: 'rule' });

  let lineDiscounts = 0;
  for (const l of input.lines) {
    const name =
      lang === 'ur'
        ? l.name_ur_snapshot || l.name_snapshot
        : lang === 'both' && l.name_ur_snapshot
          ? `${l.name_snapshot} / ${l.name_ur_snapshot}`
          : l.name_snapshot;
    const detail = l.by_amount
      ? qty(l.qty_milli, l.unit_snapshot)
      : M('receipt.qtyRate', {
          qty: qty(l.qty_milli, l.unit_snapshot),
          rate: rs(l.unit_price_paisa),
        });
    if (l.is_foc) {
      out.push({ kind: 'item', name, detail, amount: L('receipt.foc') });
      out.push({
        kind: 'pair',
        label: L('receipt.focValue'),
        value: rs(priceForQty(l.qty_milli, l.unit_price_paisa)),
      });
      continue;
    }
    // The receipt shows the price before the discount, then the discount.
    out.push({ kind: 'item', name, detail, amount: rs(l.line_total_paisa + l.discount_paisa) });
    if (l.discount_paisa > 0) {
      lineDiscounts += l.discount_paisa;
      out.push({ kind: 'pair', label: L('receipt.discount'), value: minus(l.discount_paisa) });
    }
  }
  out.push({ kind: 'rule' });

  if (lineDiscounts > 0 || sale.discount_paisa > 0 || sale.rounding_paisa !== 0) {
    out.push({
      kind: 'pair',
      label: L('receipt.subtotal'),
      value: rs(sale.subtotal_paisa + lineDiscounts),
    });
  }
  if (lineDiscounts > 0) {
    out.push({ kind: 'pair', label: L('receipt.itemDiscounts'), value: minus(lineDiscounts) });
  }
  if (sale.discount_paisa > 0) {
    out.push({ kind: 'pair', label: L('receipt.billDiscount'), value: minus(sale.discount_paisa) });
  }
  if (sale.rounding_paisa !== 0) {
    out.push({
      kind: 'pair',
      label: L('receipt.rounding'),
      value: sale.rounding_paisa > 0 ? `+${rs(sale.rounding_paisa)}` : minus(-sale.rounding_paisa),
    });
  }
  out.push({ kind: 'pair', label: L('receipt.total'), value: rs(sale.total_paisa), strong: true });

  for (const p of input.payments) {
    out.push({ kind: 'pair', label: method(p.method_code), value: rs(p.amount_paisa) });
  }
  if (input.changePaisa && input.changePaisa > 0) {
    out.push({ kind: 'pair', label: L('receipt.change'), value: rs(input.changePaisa) });
  }
  if (input.khata) {
    if (input.khata.onKhataPaisa > 0) {
      out.push({ kind: 'pair', label: L('receipt.onKhata'), value: rs(input.khata.onKhataPaisa) });
    }
    out.push({
      kind: 'pair',
      label: L('receipt.khataBalance'),
      value: rs(input.khata.balancePaisa),
      strong: true,
    });
  }
  if (shop.receipt_footer) {
    out.push({ kind: 'rule' });
    for (const text of shop.receipt_footer.split('\n')) out.push({ kind: 'center', text });
  }
  return {
    language: lang,
    dir: lang === 'ur' ? 'rtl' : 'ltr',
    paperWidthMm: shop.paper_width_mm,
    lines: out,
  };
}

/** The plain-text receipt (WhatsApp). */
export function receiptText(doc: ReceiptDoc): string {
  return doc.lines
    .map((line) => {
      switch (line.kind) {
        case 'title':
          return `*${line.text}*`;
        case 'center':
          return line.text;
        case 'item':
          return `${line.name}\n  ${line.detail} = ${line.amount}`;
        case 'pair':
          return line.strong ? `*${line.label}: ${line.value}*` : `${line.label}: ${line.value}`;
        case 'rule':
          return '------------------------';
      }
    })
    .join('\n');
}
