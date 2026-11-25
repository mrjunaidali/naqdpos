// Cash tendered on the pay screen: note buttons add up, Exact, Clear, or a typed amount.
// Pure; amounts in paisa. The tendered amount is never stored (only the applied payment is).
import { DENOMINATIONS } from './closing.ts';
import type { Paisa } from './money.ts';
import { changeDue } from './sale.ts';

/** Note and coin buttons, largest first (Rs 5000 … Rs 1). */
export const TENDER_NOTES: readonly Paisa[] = DENOMINATIONS.map((d) => d.paisa);

/** Taps that would go past this are ignored (Rs 99,99,999: what the keypad can show). */
export const MAX_TENDER_PAISA: Paisa = 999_999_900;

export interface Tender {
  /** What the customer has handed over so far. */
  paisa: Paisa;
  /** How often each note was tapped since the last Clear / Exact / typed amount (for the badges). */
  notes: Readonly<Record<number, number>>;
}

export const EMPTY_TENDER: Tender = { paisa: 0, notes: {} };

/** One more note of `note` paisa on top of what is already tendered. */
export function addNote(tender: Tender, note: Paisa): Tender {
  if (!Number.isSafeInteger(note) || note <= 0) throw new RangeError('note');
  const paisa = tender.paisa + note;
  if (paisa > MAX_TENDER_PAISA) return tender;
  return { paisa, notes: { ...tender.notes, [note]: (tender.notes[note] ?? 0) + 1 } };
}

/** Exactly what is due (no notes counted). */
export function exactTender(due: Paisa): Tender {
  return { paisa: Math.max(0, due), notes: {} };
}

/** A typed amount replaces the note taps (their badges would no longer add up). */
export function typedTender(paisa: Paisa | null): Tender {
  return { paisa: paisa !== null && paisa > 0 ? paisa : 0, notes: {} };
}

/** The tender against what is due: change back, or what is still short. */
export function tenderSummary(
  tender: Tender,
  due: Paisa,
): { change_paisa: Paisa; short_paisa: Paisa } {
  return {
    change_paisa: changeDue(tender.paisa, due),
    short_paisa: Math.max(0, due - tender.paisa),
  };
}
