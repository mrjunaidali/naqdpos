// The receipt of a sale (US036), built from Dexie: works offline and for reprints.
import {
  formatPkMobile,
  khataBalance,
  receiptFor,
  type PaymentMethodRow,
  type ReceiptDoc,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '../db/schema.ts';
import { methodName } from '../features/settings/paymentMethods.ts';

export interface SaleReceipt {
  doc: ReceiptDoc;
  /** The attached customer's mobile (E.164) for WhatsApp, else null. */
  customerMobile: string | null;
  saleStaffId: string;
}

export function useSaleReceipt(
  saleId: string | undefined,
  changePaisa?: number,
): SaleReceipt | null | undefined {
  const { i18n } = useTranslation();
  return useLiveQuery(async () => {
    if (!saleId) return null;
    const sale = await db.sales.get(saleId);
    if (!sale) return null;
    const [lines, payments, shop, staff, methods] = await Promise.all([
      db.sale_lines.where('sale_id').equals(saleId).toArray(),
      db.payments.where('sale_id').equals(saleId).toArray(),
      db.shops.get(sale.shop_id),
      db.staff.get(sale.staff_id),
      db.payment_methods.where('shop_id').equals(sale.shop_id).toArray(),
    ]);
    if (!shop) return null;
    const customer = sale.customer_id ? await db.customers.get(sale.customer_id) : undefined;
    let khata = null;
    if (customer) {
      const entries = await db.khata_entries.where('customer_id').equals(customer.id).toArray();
      // The balance right after this sale (also right on a reprint days later).
      const upToSale = entries.filter((e) => e.created_at <= sale.created_at);
      const onKhata = entries.find((e) => e.type === 'credit_sale' && e.sale_id === sale.id);
      khata = {
        customerName: customer.name ?? formatPkMobile(customer.mobile),
        onKhataPaisa: onKhata?.amount_paisa ?? 0,
        balancePaisa: khataBalance(upToSale),
      };
    }
    const en = i18n.getFixedT('en');
    const ur = i18n.getFixedT('ur');
    const byCode = new Map<string, Pick<PaymentMethodRow, 'code' | 'label'>>(
      methods.map((m) => [m.code, m]),
    );
    const doc = receiptFor({
      sale,
      lines: lines.sort((a, b) => a.id.localeCompare(b.id)),
      payments: payments.sort((a, b) => a.id.localeCompare(b.id)),
      shop: {
        ...shop,
        receipt_language: shop.receipt_language ?? 'en',
        paper_width_mm: shop.paper_width_mm ?? 58,
      },
      staffName: staff?.name ?? null,
      khata,
      ...(changePaisa !== undefined && { changePaisa }),
      methodName: (code, lang) =>
        methodName(byCode.get(code) ?? { code, label: code }, lang === 'ur' ? ur : en),
      labels: {
        en: (key, vars) => en(key, vars ?? {}),
        ur: (key, vars) => ur(key, vars ?? {}),
      },
    });
    return { doc, customerMobile: customer?.mobile ?? null, saleStaffId: sale.staff_id };
  }, [saleId, changePaisa, i18n]);
}
