// Admin portal API (US010, US011; architecture §5). Every /admin/* data route needs a platform
// admin whose session passed TOTP (admin_session_2fa) and is under 12 hours old. Data access goes
// through security-definer SQL functions that check is_platform_admin() and audit writes.
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminEnrollResponse,
  AdminMeResponse,
  AdminSessionState,
  AdminShopDetail,
  AdminShopFilters,
  AdminShopListResponse,
  AdminVerifyRequest,
  ErrorResponse,
  SetShopStatusRequest,
  SetShopStatusResponse,
  AdminVerifyResponse,
} from '@naqdpos/core';
import { createMiddleware } from 'hono/factory';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx, type Db } from '../db/index.ts';
import { errorBody, pgCode } from '../errors.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const PAGE_SIZE = 25;

type AdminEnv = AppEnv & { Variables: { sessionId: string } };

async function sessionState(db: Db, userId: string, sessionId: string): Promise<AdminSessionState> {
  return withUserTx(db, { userId, deviceId: null }, async (tx) => {
    const { rows } = await sql<{
      s: string;
    }>`select admin_session_ok(${sessionId}::uuid) as s`.execute(tx);
    return AdminSessionState.parse(rows[0]?.s ?? 'no_session');
  });
}

/** Signed in (any user): puts the user, the session id and the tx context on `c`. */
function requireSession(deps: Pick<AppDeps, 'auth'>) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    const info = await deps.auth.getSessionInfo(c.req.raw.headers);
    if (!info) return c.json(errorBody('unauthorized'), 401);
    c.set('user', info.user);
    c.set('sessionId', info.sessionId);
    c.set('tx', { userId: info.user.id, deviceId: null });
    await next();
    return undefined;
  });
}

/** A verified admin session, or 401 (signed out / older than 12 hours) / 403. */
function requireAdmin(deps: Pick<AppDeps, 'db'>) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    const state = await sessionState(deps.db, c.get('user').id, c.get('sessionId'));
    if (state === 'no_session' || state === 'session_expired') {
      return c.json(errorBody('unauthorized', state), 401);
    }
    if (state !== 'ok') return c.json(errorBody('forbidden', state), 403);
    await next();
    return undefined;
  });
}

const me = createRoute({
  method: 'get',
  path: '/admin/me',
  summary: 'Admin session state: which screen the portal shows next',
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'State', content: json(AdminMeResponse) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
  },
});
const enroll = createRoute({
  method: 'post',
  path: '/admin/2fa/enroll',
  summary: 'Start TOTP enrolment for a platform admin (QR link, secret, backup codes)',
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'Enrolment data', content: json(AdminEnrollResponse) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
    403: { description: 'Not a platform admin', content: json(ErrorResponse) },
  },
});
const verify = createRoute({
  method: 'post',
  path: '/admin/2fa/verify',
  summary: 'Verify a TOTP or backup code for this session',
  security: [{ bearer: [] }],
  request: { body: { required: true, content: json(AdminVerifyRequest) } },
  responses: {
    200: {
      description: 'Verified (with the replacement token after the first code)',
      content: json(AdminVerifyResponse),
    },
    400: { description: 'Wrong code', content: json(ErrorResponse) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
    403: { description: 'Not a platform admin', content: json(ErrorResponse) },
  },
});
const listShops = createRoute({
  method: 'get',
  path: '/admin/shops',
  summary: 'Shops, searched and filtered, newest first, 25 per page',
  security: [{ bearer: [] }],
  request: { query: AdminShopFilters },
  responses: {
    200: { description: 'A page of shops', content: json(AdminShopListResponse) },
    401: { description: 'Not signed in or session too old', content: json(ErrorResponse) },
    403: { description: 'Not a verified admin', content: json(ErrorResponse) },
  },
});
const getShop = createRoute({
  method: 'get',
  path: '/admin/shops/{id}',
  summary: 'One shop: profile, devices, staff, conflicts, audit log',
  security: [{ bearer: [] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: 'The shop', content: json(AdminShopDetail) },
    401: { description: 'Not signed in or session too old', content: json(ErrorResponse) },
    403: { description: 'Not a verified admin', content: json(ErrorResponse) },
    404: { description: 'No such shop', content: json(ErrorResponse) },
  },
});
const setStatus = createRoute({
  method: 'post',
  path: '/admin/shops/{id}/status',
  summary: 'Suspend or reactivate a shop (reason required, audit-logged)',
  security: [{ bearer: [] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { required: true, content: json(SetShopStatusRequest) },
  },
  responses: {
    200: { description: 'New status', content: json(SetShopStatusResponse) },
    400: { description: 'Invalid input', content: json(ErrorResponse) },
    401: { description: 'Not signed in or session too old', content: json(ErrorResponse) },
    403: { description: 'Not a verified admin', content: json(ErrorResponse) },
    404: { description: 'No such shop', content: json(ErrorResponse) },
  },
});

export function adminRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AdminEnv>();
  app.use('/admin/*', requireSession(deps));
  app.use('/admin/shops', requireAdmin(deps));
  app.use('/admin/shops/*', requireAdmin(deps));

  const adminOnly = async (userId: string, sessionId: string) => {
    const state = await sessionState(deps.db, userId, sessionId);
    return state === 'admin_required' || state === 'no_session' ? null : state;
  };

  return app
    .openapi(me, async (c) => {
      const state = await sessionState(deps.db, c.get('user').id, c.get('sessionId'));
      return c.json({ email: c.get('user').email, state }, 200);
    })
    .openapi(enroll, async (c) => {
      const state = await adminOnly(c.get('user').id, c.get('sessionId'));
      if (!state) return c.json(errorBody('forbidden', 'admin_required'), 403);
      if (state === 'session_expired') return c.json(errorBody('unauthorized', state), 401);
      const result = await deps.auth.enrollTwoFactor(c.req.raw.headers);
      const secret = new URL(result.totpURI).searchParams.get('secret') ?? '';
      return c.json({ totp_uri: result.totpURI, secret, backup_codes: result.backupCodes }, 200);
    })
    .openapi(verify, async (c) => {
      const state = await adminOnly(c.get('user').id, c.get('sessionId'));
      if (!state) return c.json(errorBody('forbidden', 'admin_required'), 403);
      if (state === 'session_expired') return c.json(errorBody('unauthorized', state), 401);
      const body = c.req.valid('json');
      let sessionId = c.get('sessionId');
      let newToken: string | undefined;
      if ('code' in body) {
        const result = await deps.auth.verifyTotp(c.req.raw.headers, body.code);
        if (!result.ok) return c.json(errorBody('invalid_code', 'That code is not right'), 400);
        if (result.newToken) {
          // First code: 2FA is now on and Better Auth replaced the session; verify the new one.
          newToken = result.newToken;
          const fresh = await deps.auth.getSessionInfo(
            new Headers({ authorization: `Bearer ${newToken}` }),
          );
          if (!fresh) return c.json(errorBody('unauthorized'), 401);
          sessionId = fresh.sessionId;
        }
      } else if (!(await deps.auth.verifyBackupCode(c.req.raw.headers, body.backup_code))) {
        return c.json(errorBody('invalid_code', 'That code is not right'), 400);
      }
      await withUserTx(deps.db, c.get('tx'), (tx) =>
        sql`select admin_mark_session_verified(${sessionId}::uuid)`.execute(tx),
      );
      return c.json(newToken ? { success: true, token: newToken } : { success: true }, 200);
    })
    .openapi(listShops, async (c) => {
      const { page, ...filters } = c.req.valid('query');
      const result = await withUserTx(deps.db, c.get('tx'), async (tx) => {
        const { rows } = await sql<{ r: unknown }>`
          select admin_list_shops(${JSON.stringify(filters)}::jsonb, ${page}, ${PAGE_SIZE}) as r`.execute(
          tx,
        );
        return rows[0]?.r;
      });
      return c.json(AdminShopListResponse.parse(result), 200);
    })
    .openapi(getShop, async (c) => {
      const { id } = c.req.valid('param');
      const result = await withUserTx(deps.db, c.get('tx'), async (tx) => {
        const { rows } = await sql<{ r: unknown }>`select admin_get_shop(${id}::uuid) as r`.execute(
          tx,
        );
        return rows[0]?.r ?? null;
      });
      if (!result) return c.json(errorBody('not_found'), 404);
      return c.json(AdminShopDetail.parse(result), 200);
    })
    .openapi(setStatus, async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      try {
        const result = await withUserTx(deps.db, c.get('tx'), async (tx) => {
          const { rows } = await sql<{ r: unknown }>`
            select admin_set_shop_status(${id}::uuid, ${body.status}, ${body.reason}) as r`.execute(
            tx,
          );
          return rows[0]?.r;
        });
        return c.json(SetShopStatusResponse.parse(result), 200);
      } catch (error) {
        if (pgCode(error) === 'P0002') return c.json(errorBody('not_found'), 404);
        if (pgCode(error) === '22023') return c.json(errorBody('bad_request'), 400);
        throw error;
      }
    });
}
