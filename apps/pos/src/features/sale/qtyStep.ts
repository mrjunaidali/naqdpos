// The cart panel's − / + stepper (wide screens). Built on the core line helpers: integer qty_milli,
// the line total recomputed by makeLine (qty × rate), never floats.
import {
  isLineError,
  makeLine,
  MILLI_PER_UNIT,
  type CartLine,
  type ProductUnit,
  type QtyMilli,
} from '@naqdpos/core';

/** One tap: 250 g / 250 ml for weighed items, one whole unit (piece, dozen, bundle, g) otherwise. */
export function qtyStep(unit: ProductUnit): QtyMilli {
  return unit === 'kg' || unit === 'litre' ? 250 : MILLI_PER_UNIT;
}

/**
 * The line one step up or down, or null when it can't move (never below one step, never past the
 * line limit). Discount and FOC are kept; a "by amount" line becomes a normal qty × rate line.
 */
export function stepLine(line: CartLine, direction: 1 | -1): CartLine | null {
  const step = qtyStep(line.unit);
  if (direction < 0 && line.qty_milli <= step) return null;
  const next = direction > 0 ? line.qty_milli + step : Math.max(step, line.qty_milli - step);
  const made = makeLine(line, next, line.id);
  if (isLineError(made)) return null;
  return { ...made, is_custom: line.is_custom, is_foc: line.is_foc, discount: line.discount };
}
