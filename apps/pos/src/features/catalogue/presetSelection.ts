// "Select all" on the preset picker: acts on the rows the search currently shows, skipping rows
// that are already added (their checkbox is locked).

export type SelectAllState = 'none' | 'some' | 'all';

/** Checkbox state for the visible, selectable keys. 'none' also when nothing is selectable. */
export function selectAllState(
  visible: readonly string[],
  picked: ReadonlyMap<string, string>,
): SelectAllState {
  const count = visible.filter((key) => picked.has(key)).length;
  if (count === 0) return 'none';
  return count === visible.length ? 'all' : 'some';
}

/**
 * All visible picked → untick them; otherwise tick the rest. Rows outside the search keep their
 * state, and rates already typed are kept.
 */
export function toggleAll(
  visible: readonly string[],
  picked: ReadonlyMap<string, string>,
): Map<string, string> {
  const next = new Map(picked);
  if (selectAllState(visible, picked) === 'all') {
    for (const key of visible) next.delete(key);
  } else {
    for (const key of visible) if (!next.has(key)) next.set(key, '');
  }
  return next;
}
