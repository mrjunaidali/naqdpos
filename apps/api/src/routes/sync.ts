// POST /sync/push and GET /sync/pull (architecture §4). Thin: check the app version and the
// device, validate rows with the shared schemas, then sync_push / sync_pull do the work in SQL
// (idempotency, last write wins, shop and closed-day checks, visibility).
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorResponse,
  isOlderThan,
  issueField,
  isSyncTable,
  SYNC_TABLES,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  type SyncEntry,
} from '@naqdpos/core';
import { createMiddleware } from 'hono/factory';
import { sql } from 'kysely';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx } from '../db/index.ts';
import { errorBody, pgCode } from '../errors.ts';
import { requireUser } from './require-user.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });

const common = {
  400: {
    description: 'Invalid input, or device_id differs from X-Device-Id',
    content: json(ErrorResponse),
  },
  401: { description: 'Not signed in', content: json(ErrorResponse) },
  403: {
    description: 'Not a member of the device’s shop, or the device was removed',
    content: json(ErrorResponse),
  },
  426: { description: 'App older than MIN_APP_VERSION', content: json(ErrorResponse) },
};

const pushRoute = createRoute({
  method: 'post',
  path: '/sync/push',
  summary: 'Apply up to 200 outbox entries; per-entry results',
  security: [{ bearer: [] }],
  request: { body: { required: true, content: json(SyncPushRequest) } },
  responses: {
    200: { description: 'Per-entry results', content: json(SyncPushResponse) },
    ...common,
  },
});

const pullRoute = createRoute({
  method: 'get',
  path: '/sync/pull',
  summary: 'Rows the device may see with server_seq > since_seq, in order',
  security: [{ bearer: [] }],
  request: { query: SyncPullQuery },
  responses: { 200: { description: 'One page', content: json(SyncPullResponse) }, ...common },
});

/**
 * 426 for apps older than MIN_APP_VERSION (or without X-App-Version) while it is set. Runs before
 * auth: an outdated app gets the same answer signed in or not, and only sync is gated, so the
 * app keeps selling offline (§4).
 */
export function appVersionGate(minVersion: string | undefined) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (minVersion && isOlderThan(c.req.header('x-app-version'), minVersion)) {
      return c.json({ ...errorBody('upgrade_required'), min_version: minVersion }, 426);
    }
    await next();
    return undefined;
  });
}

/** Rows are checked against their table's schema here, so one bad row is a per-entry error. */
function validateRows(entries: SyncEntry[]) {
  const valid: SyncEntry[] = [];
  const errors: SyncPushResponse['errors'] = [];
  for (const entry of entries) {
    if (!isSyncTable(entry.table)) {
      valid.push(entry); // sync_push answers unknown_table
      continue;
    }
    const result = SYNC_TABLES[entry.table].schema.safeParse(entry.row);
    if (result.success) valid.push(entry);
    else {
      // `field` (the first failed column) is extra; `code` and `message` are as before.
      const field = issueField(result.error.issues);
      errors.push({
        id: entry.id,
        code: 'invalid',
        message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        ...(field ? { field } : {}),
      });
    }
  }
  return { valid, errors };
}

export function syncRoutes(deps: Pick<AppDeps, 'db' | 'auth' | 'minAppVersion' | 'logger'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/sync/*', appVersionGate(deps.minAppVersion));
  app.use('/sync/*', requireUser(deps.auth));

  /** The device being synced is app.device_id for the whole transaction. */
  const sameDevice = (headerDevice: string | null | undefined, deviceId: string) =>
    headerDevice === deviceId;

  async function run<T>(fn: () => Promise<T>) {
    try {
      return { ok: true as const, value: await fn() };
    } catch (error) {
      // sync_device: not signed in, not a member of the device's shop, or the device was removed.
      if (pgCode(error) === '42501') return { ok: false as const };
      throw error;
    }
  }

  return app
    .openapi(pushRoute, async (c) => {
      const body = c.req.valid('json');
      const tx = c.get('tx');
      if (!sameDevice(tx.deviceId, body.device_id)) {
        return c.json(errorBody('bad_request', 'device_id must match X-Device-Id'), 400);
      }
      const { valid, errors } = validateRows(body.entries);
      const result = await run(() =>
        withUserTx(deps.db, tx, async (t) => {
          const { rows } = await sql<{ r: SyncPushResponse }>`
            select sync_push(${body.device_id}, ${JSON.stringify(valid)}::jsonb) as r`.execute(t);
          return rows[0]!.r;
        }),
      );
      if (!result.ok) return c.json(errorBody('forbidden'), 403);
      const merged: SyncPushResponse = {
        ...result.value,
        errors: [...errors, ...result.value.errors],
      };
      return c.json(merged, 200);
    })
    .openapi(pullRoute, async (c) => {
      const query = c.req.valid('query');
      const tx = c.get('tx');
      if (!sameDevice(tx.deviceId, query.device_id)) {
        return c.json(errorBody('bad_request', 'device_id must match X-Device-Id'), 400);
      }
      const result = await run(() =>
        withUserTx(deps.db, tx, async (t) => {
          // units: what the database accepts, so the app holds back rows it would reject.
          // A database behind this API version has no sync_units() (staging, 26 Nov 2026:
          // migration 20261126090000 not applied, every pull answered 500). Then the pull
          // answers like an older server, without units: the app sends only the original units.
          const { rows } = await sql<{ r: SyncPullResponse; has_units: boolean }>`
            select sync_pull(${query.device_id}, ${query.since_seq}, ${query.limit}) as r,
              to_regprocedure('public.sync_units()') is not null as has_units`.execute(t);
          const page = rows[0]!.r;
          if (!rows[0]!.has_units) {
            deps.logger.warn(
              { requestId: c.get('requestId'), path: c.req.path },
              'sync_units() is missing: the database is behind this API (run the migrations)',
            );
            return page;
          }
          const units = await sql<{ units: string[] }>`select public.sync_units() as units`.execute(
            t,
          );
          return { ...page, units: units.rows[0]!.units };
        }),
      );
      if (!result.ok) return c.json(errorBody('forbidden'), 403);
      return c.json(result.value, 200);
    });
}
