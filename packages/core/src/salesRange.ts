// Which business dates the Sales screen shows (sales history, 26 Nov 2026). Owners pick Today /
// Yesterday / This week / Custom (up to 31 days); cashiers see only the open business day since
// the last Day Close (their "current shift", US018). Pure: the screen reads one day at a time with
// a single-field equals() on business_date (Safari-safe, bug 2026-11-25).
import { nextDate } from './sale.ts';

export const SALES_PRESETS = ['today', 'yesterday', 'week', 'custom'] as const;
export type SalesPreset = (typeof SALES_PRESETS)[number];

/** Days in "This week". */
export const SALES_WEEK_DAYS = 7;
/** Longest custom range; older history is in Reports. */
export const SALES_MAX_DAYS = 31;

export interface SalesRange {
  preset: SalesPreset;
  from: string;
  to: string;
}

export type SalesRangeError = 'invalid' | 'reversed' | 'too_long' | 'future';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string | null | undefined): value is string {
  if (!value || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive, oldest first. */
export function datesBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = nextDate(d)) days.push(d);
  return days;
}

/** A preset relative to the current business date (the day new sales go to). */
export function presetRange(preset: Exclude<SalesPreset, 'custom'>, current: string): SalesRange {
  if (preset === 'yesterday') {
    const day = previousDay(current);
    return { preset, from: day, to: day };
  }
  if (preset === 'week') {
    let from = current;
    for (let i = 1; i < SALES_WEEK_DAYS; i++) from = previousDay(from);
    return { preset, from, to: current };
  }
  return { preset, from: current, to: current };
}

/** A custom range, checked: real dates, from ≤ to, at most 31 days, not after the current day. */
export function customRange(
  from: string,
  to: string,
  current: string,
): SalesRange | { error: SalesRangeError } {
  if (!isDate(from) || !isDate(to)) return { error: 'invalid' };
  if (from > to) return { error: 'reversed' };
  if (to > current) return { error: 'future' };
  if (datesBetween(from, to).length > SALES_MAX_DAYS) return { error: 'too_long' };
  return { preset: 'custom', from, to };
}

/**
 * The range in the URL (`?range=yesterday`, `?range=week`, `?from=…&to=…`); anything missing or
 * not valid is Today. Cashiers always get Today (they have no picker).
 */
export function salesRangeFromParams(
  params: { get(name: string): string | null },
  current: string,
  canPick: boolean,
): SalesRange {
  if (!canPick) return presetRange('today', current);
  const from = params.get('from');
  const to = params.get('to');
  if (from !== null || to !== null) {
    const custom = customRange(from ?? '', to ?? '', current);
    return 'error' in custom ? presetRange('today', current) : custom;
  }
  const preset = params.get('range');
  return preset === 'yesterday' || preset === 'week'
    ? presetRange(preset, current)
    : presetRange('today', current);
}

/** URL search for a range ("" for Today), so "Back to sales" returns to the same range. */
export function salesRangeSearch(range: SalesRange): string {
  if (range.preset === 'custom') return `?from=${range.from}&to=${range.to}`;
  return range.preset === 'today' ? '' : `?range=${range.preset}`;
}

/**
 * After the calendar day was closed, new sales go to a later business date: that date, for the
 * "Day closed — new sales go to …" notice; null while the calendar day is open.
 */
export function dayClosedNotice(calendarToday: string, current: string): string | null {
  return current !== calendarToday ? current : null;
}
