// Home numbers from Dexie (works offline). "Today" = the current business date, the same date new
// sales get (after a close, the next day).
import {
  businessDate,
  businessDateFor,
  lowStockCount,
  receivableTotal,
  recentActivity,
  sevenDayTrend,
  todayTotals,
  type CustomerRow,
  type RecentItem,
  type TodayTotals,
  type TrendDay,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

export interface HomeData {
  date: string;
  /** The business date is not today's calendar date (today is closed). */
  rolled: boolean;
  totals: TodayTotals;
  trend: { days: TrendDay[]; max_paisa: number };
  receivable_paisa: number;
  lowStock: number;
  recent: RecentItem[];
  customers: Map<string, CustomerRow>;
}

/** With staffId (cashiers): only their own sales and the khata entries they made. */
export function useHomeData(
  staffId: string | null | undefined,
  ownView: boolean,
): HomeData | undefined {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return undefined;
    const shop = device.shop_id;
    const [closes, sales, payments, khata, products, movements, customers] = await Promise.all([
      db.day_closes.where('shop_id').equals(shop).toArray(),
      db.sales.where('shop_id').equals(shop).toArray(),
      // payments are not indexed by shop_id; a device holds one shop, so filter in memory.
      db.payments.toArray().then((rows) => rows.filter((p) => p.shop_id === shop)),
      db.khata_entries.where('shop_id').equals(shop).toArray(),
      db.products.where('shop_id').equals(shop).toArray(),
      db.stock_movements.where('shop_id').equals(shop).toArray(),
      db.customers.where('shop_id').equals(shop).toArray(),
    ]);
    const now = new Date();
    const date = businessDateFor(now, new Set(closes.map((c) => c.business_date)));
    const own = ownView ? (staffId ?? '') : null;
    const mySales = own === null ? sales : sales.filter((s) => s.staff_id === own);
    const myKhata = own === null ? khata : khata.filter((k) => k.staff_id === own);
    return {
      date,
      rolled: date !== businessDate(now),
      totals: todayTotals(sales, payments, khata, { date, staffId: own }),
      trend: sevenDayTrend(mySales, date),
      receivable_paisa: receivableTotal(khata),
      lowStock: lowStockCount(products, movements),
      recent: recentActivity(mySales, myKhata),
      customers: new Map(customers.map((c) => [c.id, c])),
    };
  }, [staffId, ownView]);
}

/** "Good morning / afternoon / evening" by the shop's clock. */
export function greetingKey(now = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}
