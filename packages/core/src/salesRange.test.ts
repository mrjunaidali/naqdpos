import { describe, expect, it } from 'vitest';
import {
  customRange,
  datesBetween,
  dayClosedNotice,
  presetRange,
  SALES_MAX_DAYS,
  salesRangeFromParams,
  salesRangeSearch,
} from './salesRange.ts';

const CURRENT = '2026-11-26';
const params = (query: string) => new URLSearchParams(query);

describe('presetRange', () => {
  it('today, yesterday and the 7 days up to the current business date', () => {
    expect(presetRange('today', CURRENT)).toEqual({ preset: 'today', from: CURRENT, to: CURRENT });
    expect(presetRange('yesterday', CURRENT)).toMatchObject({
      from: '2026-11-25',
      to: '2026-11-25',
    });
    expect(presetRange('week', CURRENT)).toMatchObject({ from: '2026-11-20', to: CURRENT });
    expect(datesBetween('2026-11-20', CURRENT)).toHaveLength(7);
  });

  it('crosses months and years', () => {
    expect(presetRange('yesterday', '2026-03-01').from).toBe('2026-02-28');
    expect(presetRange('week', '2027-01-03').from).toBe('2026-12-28');
  });
});

describe('customRange', () => {
  it('accepts up to 31 days ending on or before the current business date', () => {
    expect(customRange('2026-10-27', CURRENT, CURRENT)).toEqual({
      preset: 'custom',
      from: '2026-10-27',
      to: CURRENT,
    });
    expect(datesBetween('2026-10-27', CURRENT)).toHaveLength(SALES_MAX_DAYS);
  });

  it('refuses longer, reversed, future and invalid ranges', () => {
    expect(customRange('2026-10-26', CURRENT, CURRENT)).toEqual({ error: 'too_long' });
    expect(customRange(CURRENT, '2026-11-20', CURRENT)).toEqual({ error: 'reversed' });
    expect(customRange(CURRENT, '2026-11-27', CURRENT)).toEqual({ error: 'future' });
    expect(customRange('2026-02-30', CURRENT, CURRENT)).toEqual({ error: 'invalid' });
    expect(customRange('', CURRENT, CURRENT)).toEqual({ error: 'invalid' });
  });
});

describe('salesRangeFromParams', () => {
  it('reads the preset or custom range from the URL; anything else is Today', () => {
    expect(salesRangeFromParams(params('range=week'), CURRENT, true).preset).toBe('week');
    expect(salesRangeFromParams(params('from=2026-11-01&to=2026-11-05'), CURRENT, true)).toEqual({
      preset: 'custom',
      from: '2026-11-01',
      to: '2026-11-05',
    });
    expect(
      salesRangeFromParams(params('from=2026-01-01&to=2026-11-05'), CURRENT, true).preset,
    ).toBe('today');
    expect(salesRangeFromParams(params('range=nope'), CURRENT, true).preset).toBe('today');
  });

  it('cashiers always get the current business day (no picker, US018)', () => {
    expect(salesRangeFromParams(params('range=week'), CURRENT, false)).toEqual({
      preset: 'today',
      from: CURRENT,
      to: CURRENT,
    });
  });

  it('round-trips through the URL', () => {
    for (const range of [
      presetRange('today', CURRENT),
      presetRange('yesterday', CURRENT),
      presetRange('week', CURRENT),
      { preset: 'custom' as const, from: '2026-11-01', to: '2026-11-05' },
    ]) {
      const search = salesRangeSearch(range);
      expect(salesRangeFromParams(params(search.slice(1)), CURRENT, true)).toEqual(range);
    }
  });
});

describe('dayClosedNotice', () => {
  it('names the day new sales go to once the calendar day is closed', () => {
    expect(dayClosedNotice('2026-11-26', '2026-11-26')).toBeNull();
    expect(dayClosedNotice('2026-11-26', '2026-11-27')).toBe('2026-11-27');
  });
});
