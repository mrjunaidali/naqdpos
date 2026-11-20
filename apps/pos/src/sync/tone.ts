import type { SyncLevel } from '@naqdpos/core';

/** Colour only where it carries meaning (docs/design-theme.md): synced, pending, needs review. */
export type SyncTone = 'success' | 'warning' | 'danger';

export function chipTone(level: SyncLevel): SyncTone {
  if (level === 'ok') return 'success';
  if (level === 'critical') return 'danger';
  return 'warning';
}
