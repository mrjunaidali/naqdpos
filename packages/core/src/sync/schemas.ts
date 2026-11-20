// POST /sync/push and GET /sync/pull (architecture §4). Shared by the API and the app's client.
// Kept deliberately loose where old and new app versions must keep talking (§4 compatibility):
// table names, error codes and pulled rows are plain strings/objects here and are checked
// against SYNC_TABLES where they are used, so a newer server never breaks an older app's parse.
import { z } from 'zod';

/** Max entries per push (§4). */
export const SYNC_PUSH_BATCH = 200;
/** Default and max rows per pull page. */
export const SYNC_PULL_LIMIT = 500;
export const SYNC_PULL_MAX = 1000;

export const OUTBOX_OPS = ['insert', 'upsert'] as const;
export type OutboxOp = (typeof OUTBOX_OPS)[number];

/** One outbox entry as it travels to the server. */
export const SyncEntry = z.object({
  /** Outbox entry id (UUIDv7); results refer to it. */
  id: z.uuid(),
  table: z.string().min(1).max(63),
  op: z.enum(OUTBOX_OPS),
  row: z.record(z.string(), z.unknown()),
});
export type SyncEntry = z.infer<typeof SyncEntry>;

export const SyncPushRequest = z.object({
  device_id: z.uuid(),
  entries: z.array(SyncEntry).max(SYNC_PUSH_BATCH),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

/**
 * Per-entry rejections. `conflict` is not here: a conflict is resolved (server row wins) and
 * comes back in `conflicts`.
 */
export const SYNC_ERROR_CODES = [
  'unknown_table',
  'not_pushable',
  'forbidden',
  'other_shop',
  'clock_ahead',
  'day_closed',
  'invalid',
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export const SyncPushResponse = z.object({
  accepted: z.array(z.string()),
  conflicts: z.array(
    z.object({ id: z.string(), table: z.string(), row: z.record(z.string(), z.unknown()) }),
  ),
  errors: z.array(z.object({ id: z.string(), code: z.string(), message: z.string().optional() })),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;

export const SyncPullQuery = z.object({
  device_id: z.uuid(),
  since_seq: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(SYNC_PULL_MAX).default(SYNC_PULL_LIMIT),
});
/** What callers pass (limit defaults to SYNC_PULL_LIMIT). */
export interface SyncPullQuery {
  device_id: string;
  since_seq: number;
  limit?: number;
}

export const SyncPullResponse = z.object({
  rows: z.array(
    z.object({
      table: z.string(),
      row: z.record(z.string(), z.unknown()),
      server_seq: z.number().int(),
    }),
  ),
  next_seq: z.number().int().nonnegative(),
  has_more: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;
