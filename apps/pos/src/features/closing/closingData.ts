// Daily closing on the device (US044, US045, US067): one day's rows from Dexie (all devices'
// rows that have synced here), writing the close through the outbox.
import {
  activityDates,
  buildDayClose,
  type DayCloseRow,
  type ExpenseRow,
  type KhataEntryRow,
  type PaymentRow,
  type SaleLineRow,
  type SaleRow,
  type StaffRow,
  type StockMovementRow,
  sortSaleLines,
} from '@naqdpos/core';
import { localWriteMany } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { SYNC_META } from '../../sync/state.ts';
import { shopClosedDates } from './closedDates.ts';
import { useRetryingLiveQuery } from '../../db/retry.ts';

export class CloseNotSaved extends Error {
  constructor(readonly reason: string) {
    super(`Day not closed: ${reason}`);
    this.name = 'CloseNotSaved';
  }
}

export interface DayRows {
  sales: SaleRow[];
  lines: SaleLineRow[];
  payments: PaymentRow[];
  khata: KhataEntryRow[];
  expenses: ExpenseRow[];
  movements: StockMovementRow[];
}

export async function dayRows(date: string): Promise<DayRows> {
  const device = await getStoredDevice();
  if (!device)
    return { sales: [], lines: [], payments: [], khata: [], expenses: [], movements: [] };
  const inShop = <T extends { shop_id: string }>(rows: T[]) =>
    rows.filter((r) => r.shop_id === device.shop_id);
  const sales = inShop(await db.sales.where('business_date').equals(date).toArray());
  // One single-field equals() per sale, not anyOf() (a cursor): Day Close reads only with
  // equals()/toArray(), which Dexie runs as getAll() with no cursor (bug 2026-11-25, iOS WebKit).
  // Sequential on purpose: no burst of parallel requests inside the live query.
  const lines: SaleLineRow[] = [];
  for (const id of [...new Set(sales.map((s) => s.id))].sort()) {
    lines.push(...(await db.sale_lines.where('sale_id').equals(id).toArray()));
  }
  return {
    sales,
    lines: sortSaleLines(lines),
    payments: inShop(await db.payments.where('business_date').equals(date).toArray()),
    khata: inShop(await db.khata_entries.where('business_date').equals(date).toArray()),
    expenses: inShop(await db.expenses.where('business_date').equals(date).toArray()),
    movements: inShop(await db.stock_movements.where('business_date').equals(date).toArray()),
  };
}

export function useDayRows(date: string | undefined): DayRows | undefined {
  return useRetryingLiveQuery(async () => (date ? dayRows(date) : undefined), [date]);
}

export function useDayCloses(): DayCloseRow[] | undefined {
  return useRetryingLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    return (await db.day_closes.where('shop_id').equals(device.shop_id).toArray()).sort((a, b) =>
      b.business_date.localeCompare(a.business_date),
    );
  });
}

/**
 * Business dates with any activity (sales, payments, expenses, stock, khata). Plain toArray() per
 * table, deduped in core: orderBy('business_date').uniqueKeys() opened a unique-direction key
 * cursor, which iOS WebKit refuses with "UnknownError: Unable to open cursor" (bug 2026-11-25).
 */
export async function readActivityDates(): Promise<Set<string>> {
  const tables = [db.sales, db.payments, db.expenses, db.stock_movements, db.khata_entries];
  const rows: { business_date?: unknown }[][] = [];
  for (const table of tables) rows.push(await table.toArray());
  return new Set(activityDates(...rows));
}

export function useActivityDates(): Set<string> | undefined {
  return useRetryingLiveQuery(readActivityDates);
}

export async function closeDay(
  input: {
    businessDate: string;
    openingPaisa: number;
    expectedPaisa: number;
    countedPaisa: number;
    withdrawalPaisa: number;
    note: string | null;
  },
  owner: StaffRow,
): Promise<DayCloseRow> {
  const device = await getStoredDevice();
  if (!device) throw new CloseNotSaved('no_device');
  // What this device had pulled when it closed: rows above it were not seen (architecture §4).
  const cursor = Number((await db.meta.get(SYNC_META.CURSOR))?.value ?? 0);
  const built = buildDayClose(
    { ...input, seenThroughSeq: Number.isSafeInteger(cursor) ? cursor : 0 },
    {
      shopId: device.shop_id,
      deviceId: device.id,
      staffId: owner.id,
      role: owner.role,
      now: new Date(),
      closedDates: await shopClosedDates(),
    },
  );
  if ('error' in built) throw new CloseNotSaved(built.error);
  await localWriteMany([{ table: 'day_closes', op: 'insert', row: { ...built } }], db, {
    actorStaffId: owner.id,
  });
  return built;
}

/** Cost per unit at the end of `date` (owner devices only; elsewhere the map is empty). */
export async function costsAt(date: string): Promise<Map<string, number> | undefined> {
  const device = await getStoredDevice();
  if (device?.mode !== 'owner') return undefined;
  const end = `${date}T23:59:59.999+05:00`;
  const latest = new Map<string, { at: string; cost: number }>();
  for (const h of await db.product_cost_history.toArray()) {
    if (h.effective_at > end) continue;
    const prev = latest.get(h.product_id);
    if (!prev || h.effective_at > prev.at)
      latest.set(h.product_id, { at: h.effective_at, cost: h.cost_price_paisa });
  }
  return new Map([...latest].map(([id, v]) => [id, v.cost]));
}
