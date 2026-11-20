// Stock (US024, US025; architecture §3 stock_movements, derived values). Stock of a product is
// always the sum of its movements (integer qty_milli); nothing stores a stock figure. Stock never
// blocks a sale and may go negative. Movements carry no cost (every device pulls them).
import type { ProductRow, ProductUnit } from './catalogue.ts';
import { uuidv7 } from './ids.ts';
import { formatQty, type QtyMilli } from './qty.ts';
import type { SaleLineRow } from './sale.ts';
import { businessDate } from './sale.ts';
import type { Role } from './tenancy.ts';

export const STOCK_REASONS = [
  'sale',
  'return',
  'purchase',
  'wastage',
  'damaged',
  'count_correction',
  'combo_component',
] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export interface StockMovementRow {
  id: string;
  shop_id: string;
  product_id: string;
  business_date: string;
  /** Signed: + stock in, − stock out. Never 0. */
  qty_milli: QtyMilli;
  reason: StockReason;
  /** For 'sale': the sale id. */
  ref_id: string | null;
  note: string | null;
  staff_id: string;
  created_at: string;
  device_id: string | null;
  server_seq: number | null;
}

export const MAX_STOCK_NOTE_LENGTH = 200;

/** Who may record which reason; the server checks the same in stock_movements_check(). */
const REASON_ROLES: Record<StockReason, readonly Role[]> = {
  sale: ['owner', 'cashier'],
  return: ['owner', 'cashier'],
  wastage: ['owner', 'cashier'],
  damaged: ['owner', 'cashier'],
  purchase: ['owner'],
  count_correction: ['owner'],
  combo_component: ['owner', 'cashier'],
};

export function canRecordStockReason(role: Role | null | undefined, reason: StockReason): boolean {
  return !!role && REASON_ROLES[reason].includes(role);
}

// --- Sums ---

/** Stock from a product's movements: their sum (0 with none). */
export function stockOf(movements: readonly Pick<StockMovementRow, 'qty_milli'>[]): QtyMilli {
  let total = 0;
  for (const m of movements) total += m.qty_milli;
  if (!Number.isSafeInteger(total)) throw new RangeError('stock out of range');
  return total;
}

/** Stock of every product that has movements (a product missing from the map has 0). */
export function stockByProduct(
  movements: readonly Pick<StockMovementRow, 'product_id' | 'qty_milli'>[],
): Map<string, QtyMilli> {
  const totals = new Map<string, QtyMilli>();
  for (const m of movements)
    totals.set(m.product_id, (totals.get(m.product_id) ?? 0) + m.qty_milli);
  for (const [, total] of totals) {
    if (!Number.isSafeInteger(total)) throw new RangeError('stock out of range');
  }
  return totals;
}

/** "Check stock": tracked stock at or below zero. */
export function needsStockCheck(qtyMilli: QtyMilli): boolean {
  return qtyMilli <= 0;
}

// --- Building movements ---

export interface StockContext {
  shopId: string;
  deviceId: string | null;
  staffId: string;
  now: Date;
}

function movement(
  ctx: StockContext,
  productId: string,
  qtyMilli: QtyMilli,
  reason: StockReason,
  refId: string | null,
  note: string | null,
): StockMovementRow {
  return {
    id: uuidv7(),
    shop_id: ctx.shopId,
    product_id: productId,
    business_date: businessDate(ctx.now),
    qty_milli: qtyMilli,
    reason,
    ref_id: refId,
    note,
    staff_id: ctx.staffId,
    created_at: ctx.now.toISOString(),
    device_id: ctx.deviceId,
    server_seq: null,
  };
}

/**
 * One 'sale' movement (negative) per line whose product tracks stock. Custom items (no product)
 * never move stock; free (FOC) lines do, since the goods leave the shop.
 */
export function buildSaleMovements(
  lines: readonly Pick<SaleLineRow, 'sale_id' | 'product_id' | 'qty_milli'>[],
  products: ReadonlyMap<string, Pick<ProductRow, 'track_stock'>>,
  ctx: StockContext,
): StockMovementRow[] {
  const rows: StockMovementRow[] = [];
  for (const line of lines) {
    if (!line.product_id || line.qty_milli <= 0) continue;
    if (!products.get(line.product_id)?.track_stock) continue;
    rows.push(movement(ctx, line.product_id, -line.qty_milli, 'sale', line.sale_id, null));
  }
  return rows;
}

export type StockAction = 'wastage' | 'damaged' | 'stock_in' | 'set_stock';
export type StockActionError = 'bad_qty' | 'note_too_long' | 'forbidden';

export interface StockActionInput {
  action: StockAction;
  productId: string;
  unit: ProductUnit;
  /** Wastage, damaged, stock in: the amount (> 0). Set stock: the counted stock (≥ 0). */
  qtyMilli: QtyMilli;
  /** Current stock on this device (set stock only). */
  currentMilli?: QtyMilli | undefined;
  note?: string | null;
  role: Role | null | undefined;
}

const ACTION_REASON: Record<StockAction, StockReason> = {
  wastage: 'wastage',
  damaged: 'damaged',
  stock_in: 'purchase',
  set_stock: 'count_correction',
};

export function stockActionReason(action: StockAction): StockReason {
  return ACTION_REASON[action];
}

/** The note kept on a count correction, so the owner sees what was counted: "counted 12.5 kg". */
export function countNote(countedMilli: QtyMilli, unit: ProductUnit): string {
  return `counted ${formatQty(countedMilli)} ${unit}`;
}

/**
 * The movement for a stock screen action, or null when nothing changes (a count equal to the
 * current stock). Wastage / damaged are negative, stock in positive, set stock = counted − current.
 */
export function buildStockAction(
  input: StockActionInput,
  ctx: StockContext,
): StockMovementRow | null | { error: StockActionError } {
  const reason = ACTION_REASON[input.action];
  if (!canRecordStockReason(input.role, reason)) return { error: 'forbidden' };
  const qty = input.qtyMilli;
  if (!Number.isSafeInteger(qty) || qty < 0 || (input.action !== 'set_stock' && qty === 0)) {
    return { error: 'bad_qty' };
  }
  const typed = input.note?.trim() || null;
  if (typed && [...typed].length > MAX_STOCK_NOTE_LENGTH) return { error: 'note_too_long' };

  if (input.action === 'set_stock') {
    const current = input.currentMilli ?? 0;
    const difference = qty - current;
    if (difference === 0) return null;
    return movement(ctx, input.productId, difference, reason, null, countNote(qty, input.unit));
  }
  const signed = input.action === 'stock_in' ? qty : -qty;
  return movement(ctx, input.productId, signed, reason, null, typed);
}
