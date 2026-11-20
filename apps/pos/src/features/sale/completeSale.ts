// Completing a sale (US034, US035): ONE Dexie transaction writes sales + sale_lines + payments
// with their outbox entries, moves the per-device receipt counter and clears the stored cart.
// All of it or none of it, and it never waits for the network (rule 1).
import {
  buildSale,
  receiptCounter,
  receiptNo,
  type PaymentDraft,
  type SaleError,
  type SaleRows,
} from '@naqdpos/core';
import { localWriteMany, type LocalWrite } from '../../db/outbox.ts';
import { db as defaultDb, type NaqdDb } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { readCurrentStaffId } from '../../staff/currentStaff.ts';
import { CART_KEY, cartSaved, useCartStore } from './cartStore.ts';

export const RECEIPT_COUNTER_KEY = 'receipt_counter';

interface StoredCounter {
  /** The device code the counter belongs to (a new code starts again at 1). */
  code: string;
  last: number;
}

export class SaleNotCompleted extends Error {
  constructor(readonly reason: SaleError | 'no_device' | 'no_staff') {
    super(`Sale not completed: ${reason}`);
    this.name = 'SaleNotCompleted';
  }
}

/**
 * The last receipt counter used on this device: the stored counter, but never below the highest
 * receipt number of this device code already in local sales (receipt numbers never repeat, even
 * if the counter was lost). Run inside a transaction that includes meta and sales.
 */
async function lastCounter(database: NaqdDb, code: string): Promise<number> {
  const stored = (await database.meta.get(RECEIPT_COUNTER_KEY))?.value as StoredCounter | undefined;
  const fromMeta = stored?.code === code ? stored.last : 0;
  let fromSales = 0;
  await database.sales
    .where('receipt_no')
    .startsWith(`${code}-`)
    .each((sale) => {
      const n = receiptCounter(sale.receipt_no, code);
      if (n !== null && n > fromSales) fromSales = n;
    });
  return Math.max(fromMeta, fromSales);
}

/** On start: bring the stored counter up to the sales on the device. */
export async function reconcileReceiptCounter(database: NaqdDb = defaultDb): Promise<number> {
  const device = await getStoredDevice();
  if (!device) return 0;
  return database.transaction('rw', [database.meta, database.sales], async () => {
    const last = await lastCounter(database, device.code);
    await database.meta.put({ key: RECEIPT_COUNTER_KEY, value: { code: device.code, last } });
    return last;
  });
}

export async function completeSale(
  payments: readonly PaymentDraft[],
  options: { now?: Date; database?: NaqdDb } = {},
): Promise<SaleRows> {
  const database = options.database ?? defaultDb;
  const device = await getStoredDevice();
  if (!device) throw new SaleNotCompleted('no_device');
  const staffId = await readCurrentStaffId(database);
  const staff = staffId ? await database.staff.get(staffId) : undefined;
  if (!staffId || !staff?.active || staff.deleted_at !== null)
    throw new SaleNotCompleted('no_staff');
  // A cart write still queued must land before the sale clears the stored cart.
  await cartSaved();
  const cart = useCartStore.getState().lines;

  const rows = await database.transaction(
    'rw',
    [database.sales, database.sale_lines, database.payments, database.outbox, database.meta],
    async () => {
      const n = (await lastCounter(database, device.code)) + 1;
      const built = buildSale(cart, payments, {
        shopId: device.shop_id,
        deviceId: device.id,
        staffId,
        receiptNo: receiptNo(device.code, n),
        now: options.now ?? new Date(),
      });
      if ('error' in built) throw new SaleNotCompleted(built.error);

      // Sale first, then lines, then payments: the outbox pushes in this order (parents first).
      const writes: LocalWrite[] = [
        { table: 'sales', op: 'insert', row: { ...built.sale } },
        ...built.lines.map((row): LocalWrite => ({
          table: 'sale_lines',
          op: 'insert',
          row: { ...row },
        })),
        ...built.payments.map((row): LocalWrite => ({
          table: 'payments',
          op: 'insert',
          row: { ...row },
        })),
      ];
      await localWriteMany(writes, database, { actorStaffId: staffId });
      await database.meta.put({ key: RECEIPT_COUNTER_KEY, value: { code: device.code, last: n } });
      await database.meta.put({ key: CART_KEY, value: { lines: [] } });
      return built;
    },
  );
  useCartStore.setState({ lines: [] });
  return rows;
}
