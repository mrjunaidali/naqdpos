// Owner reports come from the server (all devices' data; architecture §5). Owner-mode devices keep
// the last result per report + range + filters in Dexie report_cache for offline viewing, with
// its "as of" time. Shop-mode devices never store report data: they need the network (and the
// owner PIN, via OwnerPinGate on the route).
import type {
  ExpenseReportQuery,
  ExpenseReportResponse,
  ProductReportResponse,
  ReportSummaryResponse,
  StaffReportResponse,
} from '@naqdpos/core';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { readWithRetry } from '../../db/retry.ts';
import { getStoredDevice } from '../../db/session.ts';

export interface ReportResults {
  summary: ReportSummaryResponse;
  products: ProductReportResponse;
  staff: StaffReportResponse;
  expenses: ExpenseReportResponse;
}
export type ReportKind = keyof ReportResults;

export type ReportFilters = Pick<ExpenseReportQuery, 'category_id' | 'method_code' | 'staff_id'>;

export type ReportState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; asOf: string; offline: boolean }
  /** Shop device (or owner device with nothing cached) without a connection. */
  | { status: 'needs_internet' }
  | { status: 'error' };

export const MAX_CACHED_REPORTS = 50;

export function reportKey(
  kind: ReportKind,
  shopId: string,
  from: string,
  to: string,
  filters: ReportFilters = {},
): string {
  const f = [filters.category_id, filters.method_code, filters.staff_id].map((v) => v ?? '');
  return [kind, shopId, from, to, ...f].join(':');
}

function call<K extends ReportKind>(
  kind: K,
  query: { shop_id: string; from: string; to: string } & ReportFilters,
): Promise<ReportResults[K]> {
  const base = { shop_id: query.shop_id, from: query.from, to: query.to };
  switch (kind) {
    case 'summary':
      return api.reportSummary(base) as Promise<ReportResults[K]>;
    case 'products':
      return api.reportProducts(base) as Promise<ReportResults[K]>;
    case 'staff':
      return api.reportStaff(base) as Promise<ReportResults[K]>;
    default:
      return api.reportExpenses(query) as Promise<ReportResults[K]>;
  }
}

/** Keeps the newest MAX_CACHED_REPORTS results. */
async function remember(key: string, value: unknown, savedAt: string) {
  await db.transaction('rw', db.report_cache, async () => {
    await db.report_cache.put({ key, saved_at: savedAt, value });
    const count = await db.report_cache.count();
    if (count > MAX_CACHED_REPORTS) {
      // A few rows: read them and pick the oldest in JS, no orderBy().limit() index cursor
      // (bug 2026-11-25, iOS WebKit).
      const old = (await db.report_cache.toArray())
        .sort((x, y) => (x.saved_at < y.saved_at ? -1 : x.saved_at > y.saved_at ? 1 : 0))
        .slice(0, count - MAX_CACHED_REPORTS)
        .map((row) => row.key);
      await db.report_cache.bulkDelete(old);
    }
  });
}

const isNetwork = (e: unknown) => e instanceof ApiError && e.status === 0;

export async function loadReport<K extends ReportKind>(
  kind: K,
  from: string,
  to: string,
  filters: ReportFilters = {},
): Promise<ReportState<ReportResults[K]>> {
  const device = await getStoredDevice();
  if (!device) return { status: 'error' };
  const ownerDevice = device.mode === 'owner';
  const key = reportKey(kind, device.shop_id, from, to, filters);
  const cached = async (): Promise<ReportState<ReportResults[K]>> => {
    if (!ownerDevice) return { status: 'needs_internet' };
    const row = await readWithRetry(() => db.report_cache.get(key));
    return row
      ? { status: 'ready', data: row.value as ReportResults[K], asOf: row.saved_at, offline: true }
      : { status: 'needs_internet' };
  };
  if (!navigator.onLine) return cached();
  try {
    const data = await call(kind, { shop_id: device.shop_id, from, to, ...filters });
    const asOf = new Date().toISOString();
    if (ownerDevice) await remember(key, data, asOf);
    return { status: 'ready', data, asOf, offline: false };
  } catch (e) {
    return isNetwork(e) ? cached() : { status: 'error' };
  }
}

/** Loads (and reloads when the inputs change) one report. */
export function useReport<K extends ReportKind>(
  kind: K,
  from: string | undefined,
  to: string | undefined,
  filters: ReportFilters = {},
): ReportState<ReportResults[K]> {
  const [state, setState] = useState<{ key: string; value: ReportState<ReportResults[K]> }>();
  const inputs = [kind, from, to, filters.category_id, filters.method_code, filters.staff_id].join(
    '|',
  );
  useEffect(() => {
    if (!from || !to) return;
    let alive = true;
    void loadReport(kind, from, to, filters).then((value) => {
      if (alive) setState({ key: inputs, value });
    });
    return () => {
      alive = false;
    };
    // `inputs` covers kind, range and filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs]);
  return state?.key === inputs ? state.value : { status: 'loading' };
}
