// Outbox rules shared by the shop app's sync engine and Sync screen (architecture §4, §7):
// which entries wait for a server that knows their unit, how a rejected entry goes back to the
// outbox, and how a rejected entry is named on screen. Pure functions; Dexie stays in the app.

/**
 * Units every server version accepts (the list before `ml`, 25 Nov 2026). A server that does not
 * advertise its units on pull (an API older than 20261126090000) is assumed to know only these.
 */
export const BASELINE_SERVER_UNITS = ['kg', 'g', 'dozen', 'piece', 'bundle', 'litre'] as const;

/** The column that holds a unit, per synced table that has one. */
export const UNIT_COLUMNS: Readonly<Record<string, string>> = {
  products: 'unit',
  sale_lines: 'unit_snapshot',
};

/**
 * The unit in this entry that the server does not accept yet, or null when it can be sent.
 * Deploy-order safeguard (bug 2026-11-25): a new app can reach a device before the API and
 * database that accept its new unit; such entries stay in the outbox instead of being rejected.
 * `serverUnits` null = the server did not say (older API): only the baseline units are sent.
 */
export function unitServerLacks(
  entry: { table: string; row: Record<string, unknown> },
  serverUnits: readonly string[] | null,
): string | null {
  const column = UNIT_COLUMNS[entry.table];
  if (!column) return null;
  const unit = entry.row[column];
  if (typeof unit !== 'string') return null; // the server's own checks answer this one
  const known: readonly string[] = serverUnits ?? BASELINE_SERVER_UNITS;
  return known.includes(unit) ? null : unit;
}

/** What the device keeps for an entry the server rejected (Dexie `sync_errors`). */
export interface RejectedFields {
  code: string;
  message: string | null;
  field?: string | null;
  rejected_at: string;
}

/**
 * "Try again" on the Sync screen: the rejected entry as a fresh outbox entry (same id, so a
 * retry the server already applied is still a no-op there; attempts start over). The server
 * checks it again exactly like a first push (write_roles, RLS, constraints).
 */
export function toRetryEntry<T extends RejectedFields & { attempts: number }>(
  rejected: T,
): Omit<T, keyof RejectedFields> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const { code, message, field, rejected_at, ...entry } = rejected;
  return { ...entry, attempts: 0 };
}

/**
 * A name a person recognises for a synced row (product, customer, staff, line item…), or null
 * when the row has none (ledger rows such as payments).
 */
export function syncRecordName(table: string, row: Record<string, unknown>): string | null {
  const text = (key: string) => {
    const value = row[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  if (table === 'sale_lines') return text('name_snapshot');
  if (table === 'sales') return text('receipt_no');
  if (table === 'customers') return text('name') ?? text('mobile');
  return text('name');
}

/**
 * The field a schema issue points at (top-level column), for the per-entry `field` in a
 * sync_push rejection. Null when the issue is about the row as a whole.
 */
export function issueField(issues: readonly { path: readonly PropertyKey[] }[]): string | null {
  const first = issues[0]?.path[0];
  return typeof first === 'string' ? first : null;
}

/**
 * A pulled row this app could not store (it failed its table's schema). Kept in `sync_errors`
 * with `op: 'pull'` so it never disappears quietly; it is not pushed again ("Try again" does not
 * apply: the fix is an app update or a server correction). One record per row: a newer bad
 * version replaces it, and storing the row later removes it.
 */
export const PULL_OP = 'pull';
export const PULL_INVALID = 'pull_invalid';

export function isPullProblem(entry: { op: string }): boolean {
  return entry.op === PULL_OP;
}

/** The record id for a pulled row ("pull:products:<id>"). */
export function pullProblemId(rowKey: string): string {
  return `pull:${rowKey}`;
}

/** row_key of a pulled row even when its key column is missing or not a string. */
export function pulledRowKey(
  table: string,
  keyColumn: string,
  row: Record<string, unknown>,
): string {
  const key = row[keyColumn];
  return `${table}:${typeof key === 'string' && key !== '' ? key : '?'}`;
}

/** "unit: Invalid input; name: Too small" from schema issues. */
export function issuesMessage(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  return issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');
}
