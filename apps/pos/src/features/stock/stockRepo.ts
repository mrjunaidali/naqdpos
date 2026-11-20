// Stock screen writes (US025): wastage / damaged, stock in, set stock (count). Each is one
// movement through the outbox, offline, with the acting staff member as actor and staff_id.
import {
  buildStockAction,
  stockOf,
  type ProductRow,
  type StaffRow,
  type StockAction,
  type StockActionError,
  type StockMovementRow,
} from '@naqdpos/core';
import { localWriteMany } from '../../db/outbox.ts';
import { db as defaultDb, type NaqdDb } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

export class StockNotRecorded extends Error {
  constructor(readonly reason: StockActionError | 'no_device' | 'no_staff') {
    super(`Stock not recorded: ${reason}`);
    this.name = 'StockNotRecorded';
  }
}

export interface StockActionRequest {
  action: StockAction;
  product: Pick<ProductRow, 'id' | 'unit'>;
  /** Amount for wastage / damaged / stock in; the counted stock for set stock. */
  qtyMilli: number;
  note?: string | null;
  /** Who does it: the switched-in staff member, or the owner who entered their PIN. */
  staff: StaffRow | undefined;
}

export async function currentStock(productId: string, database: NaqdDb = defaultDb) {
  return stockOf(await database.stock_movements.where('product_id').equals(productId).toArray());
}

/**
 * Records one stock action; null when nothing changes (a count equal to the stock). Set stock
 * reads the current stock inside the same transaction, so the difference matches what is written.
 */
export async function recordStockAction(
  request: StockActionRequest,
  options: { now?: Date; database?: NaqdDb } = {},
): Promise<StockMovementRow | null> {
  const database = options.database ?? defaultDb;
  const device = await getStoredDevice();
  if (!device) throw new StockNotRecorded('no_device');
  const staff = request.staff;
  if (!staff || !staff.active || staff.deleted_at !== null) throw new StockNotRecorded('no_staff');

  return database.transaction('rw', [database.stock_movements, database.outbox], async () => {
    const built = buildStockAction(
      {
        action: request.action,
        productId: request.product.id,
        unit: request.product.unit,
        qtyMilli: request.qtyMilli,
        currentMilli:
          request.action === 'set_stock'
            ? await currentStock(request.product.id, database)
            : undefined,
        note: request.note ?? null,
        role: staff.role,
      },
      {
        shopId: device.shop_id,
        deviceId: device.id,
        staffId: staff.id,
        now: options.now ?? new Date(),
      },
    );
    if (built === null) return null;
    if ('error' in built) throw new StockNotRecorded(built.error);
    await localWriteMany(
      [{ table: 'stock_movements', op: 'insert', row: { ...built } }],
      database,
      {
        actorStaffId: staff.id,
      },
    );
    return built;
  });
}

/** How long Set stock waits for "Sync now" before asking to count anyway. */
export const COUNT_SYNC_TIMEOUT_MS = 8000;

/**
 * Before a count: pull other devices' sales first. true = synced; false = offline, failed or too
 * slow (the screen then asks "count anyway?").
 */
export async function syncBeforeCount(
  syncNow: () => Promise<string>,
  timeoutMs = COUNT_SYNC_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([syncNow().catch(() => 'failed'), timeout]);
    return outcome === 'synced';
  } finally {
    clearTimeout(timer);
  }
}
