import { describe, expect, it } from 'vitest';
import {
  addNote,
  EMPTY_TENDER,
  exactTender,
  MAX_TENDER_PAISA,
  TENDER_NOTES,
  tenderSummary,
  typedTender,
} from './tender.ts';

describe('tender (note buttons)', () => {
  it('offers Rs 5000 down to Rs 1, largest first', () => {
    expect(TENDER_NOTES).toEqual([
      500_000, 100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
    ]);
  });

  it('each tap adds its amount and counts the note', () => {
    let t = addNote(EMPTY_TENDER, 10_000);
    t = addNote(t, 10_000);
    t = addNote(t, 50_000);
    expect(t).toEqual({ paisa: 70_000, notes: { 10_000: 2, 50_000: 1 } });
    expect(EMPTY_TENDER).toEqual({ paisa: 0, notes: {} }); // not changed
  });

  it('change and short against what is due', () => {
    const t = addNote(addNote(EMPTY_TENDER, 10_000), 10_000); // Rs 200
    expect(tenderSummary(t, 21_500)).toEqual({ change_paisa: 0, short_paisa: 1_500 });
    const more = addNote(t, 5_000); // Rs 250
    expect(tenderSummary(more, 21_500)).toEqual({ change_paisa: 3_500, short_paisa: 0 });
    expect(tenderSummary(EMPTY_TENDER, 21_500)).toEqual({ change_paisa: 0, short_paisa: 21_500 });
  });

  it('Exact tenders what is due; a tap after it adds on top', () => {
    const exact = exactTender(21_500);
    expect(exact).toEqual({ paisa: 21_500, notes: {} });
    expect(tenderSummary(exact, 21_500)).toEqual({ change_paisa: 0, short_paisa: 0 });
    expect(addNote(exact, 1_000)).toEqual({ paisa: 22_500, notes: { 1_000: 1 } });
    expect(exactTender(-5)).toEqual(EMPTY_TENDER);
  });

  it('Clear and a typed amount drop the note counts', () => {
    const t = addNote(EMPTY_TENDER, 50_000);
    expect(typedTender(30_050)).toEqual({ paisa: 30_050, notes: {} });
    expect(typedTender(null)).toEqual(EMPTY_TENDER);
    expect(typedTender(0)).toEqual(EMPTY_TENDER);
    expect(t.notes).toEqual({ 50_000: 1 });
  });

  it('ignores a tap past the maximum and refuses a bad note', () => {
    const near = typedTender(MAX_TENDER_PAISA - 100);
    expect(addNote(near, 100).paisa).toBe(MAX_TENDER_PAISA);
    expect(addNote(addNote(near, 100), 100).paisa).toBe(MAX_TENDER_PAISA);
    expect(() => addNote(EMPTY_TENDER, 0)).toThrow(RangeError);
    expect(() => addNote(EMPTY_TENDER, 1.5)).toThrow(RangeError);
  });
});
