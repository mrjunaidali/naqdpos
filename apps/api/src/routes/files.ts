// /files/* (architecture §9; US014 logo). The API never streams files: it signs short-lived URLs
// for keys on the allow list (core files.ts) and the device talks to storage directly. Checks:
// the session (requireUser), the role in the key's shop (members read, owners write) through
// RLS-scoped memberships, and the key pattern. The logo row itself is written through sync_push
// (write_roles), so the database checks it again (CLAUDE.md rule 7).
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  can,
  DownloadUrlRequest,
  DownloadUrlResponse,
  ErrorResponse,
  logoKey,
  logoPrefix,
  LogoCleanupRequest,
  LogoCleanupResponse,
  parseFileKey,
  UploadUrlRequest,
  UploadUrlResponse,
  uuidv7,
} from '@naqdpos/core';
import { sql } from 'kysely';
import type { z } from 'zod';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx } from '../db/index.ts';
import { shopRole } from '../db/roles.ts';
import { errorBody } from '../errors.ts';
import { requireUser } from './require-user.ts';

/** Seconds a signed URL is valid. */
const UPLOAD_TTL = 5 * 60;
const DOWNLOAD_TTL = 10 * 60;
/** A logo younger than this may still be on its way into shops.logo_path: never cleaned up. */
const CLEANUP_MIN_AGE_MS = 60 * 60 * 1000;
/** Per user, in memory: correct for ONE API instance (deployment §5). */
const LIMIT_PER_MINUTE = 30;

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const failures = {
  400: { description: 'Key or input not allowed', content: json(ErrorResponse) },
  401: { description: 'Not signed in', content: json(ErrorResponse) },
  403: { description: 'Not allowed in this shop', content: json(ErrorResponse) },
  404: { description: 'Storage not configured (files_disabled)', content: json(ErrorResponse) },
  429: { description: 'Too many requests', content: json(ErrorResponse) },
};

function post<Req extends z.ZodType, Res extends z.ZodType>(
  path: string,
  request: Req,
  response: Res,
  summary: string,
) {
  return createRoute({
    method: 'post',
    path,
    summary,
    security: [{ bearer: [] }],
    request: { body: { content: json(request), required: true } },
    responses: { 200: { description: 'OK', content: json(response) }, ...failures },
  });
}

const uploadRoute = post(
  '/files/upload-url',
  UploadUrlRequest,
  UploadUrlResponse,
  'Pre-signed upload URL (owner: shop logo)',
);
const downloadRoute = post(
  '/files/download-url',
  DownloadUrlRequest,
  DownloadUrlResponse,
  'Pre-signed download URL (shop members)',
);
const cleanupRoute = post(
  '/files/logo/cleanup',
  LogoCleanupRequest,
  LogoCleanupResponse,
  'Delete old logo objects (owner)',
);

/** Tiny fixed-window counter per user. */
export function rateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { start: number; n: number }>();
  return (id: string): boolean => {
    const t = now();
    const entry = hits.get(id);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(id, { start: t, n: 1 });
      if (hits.size > 10_000)
        for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return true;
    }
    entry.n += 1;
    return entry.n <= limit;
  };
}

export function fileRoutes(deps: Pick<AppDeps, 'db' | 'auth' | 'files' | 'logger'>) {
  const app = new OpenAPIHono<AppEnv>();
  const allow = rateLimiter(LIMIT_PER_MINUTE, 60_000);
  app.use('/files/*', requireUser(deps.auth));
  app.use('/files/*', async (c, next) => {
    if (!deps.files)
      return c.json(errorBody('files_disabled', 'File storage is not configured'), 404);
    if (!allow(c.get('user').id)) return c.json(errorBody('rate_limited'), 429);
    await next();
    return undefined;
  });

  const roleIn = (context: AppEnv['Variables']['tx'], shopId: string) =>
    withUserTx(deps.db, context, (tx) => shopRole(tx, shopId));

  return app
    .openapi(uploadRoute, async (c) => {
      const body = c.req.valid('json');
      if (!can(await roleIn(c.get('tx'), body.shop_id), 'manage_shop_settings'))
        return c.json(errorBody('forbidden'), 403);
      const key = logoKey(body.shop_id, uuidv7(), body.content_type);
      const url = await deps.files!.presignPut(key, body.content_type, UPLOAD_TTL);
      return c.json({ key, url, expires_in: UPLOAD_TTL }, 200);
    })
    .openapi(downloadRoute, async (c) => {
      const parsed = parseFileKey(c.req.valid('json').key);
      if (!parsed) return c.json(errorBody('bad_request', 'This key is not allowed'), 400);
      if (!(await roleIn(c.get('tx'), parsed.shopId))) return c.json(errorBody('forbidden'), 403);
      const url = await deps.files!.presignGet(c.req.valid('json').key, DOWNLOAD_TTL);
      return c.json({ url, expires_in: DOWNLOAD_TTL }, 200);
    })
    .openapi(cleanupRoute, async (c) => {
      const shopId = c.req.valid('json').shop_id;
      const current = await withUserTx(deps.db, c.get('tx'), async (tx) => {
        if (!can(await shopRole(tx, shopId), 'manage_shop_settings'))
          return { allowed: false } as const;
        const { rows } = await sql<{ logo_path: string | null }>`
          select logo_path from shops where id = ${shopId}`.execute(tx);
        return { allowed: true, key: rows[0]?.logo_path ?? null } as const;
      });
      if (!current.allowed) return c.json(errorBody('forbidden'), 403);
      // Best effort (US014): the previous logo goes once the new key is saved. Failures are
      // logged; the next logo change cleans up again.
      try {
        const cutoff = Date.now() - CLEANUP_MIN_AGE_MS;
        const old = (await deps.files!.list(logoPrefix(shopId)))
          .filter((o) => o.key !== current.key && o.lastModified.getTime() < cutoff)
          .map((o) => o.key);
        if (old.length) await deps.files!.delete(old);
        return c.json({ deleted: old.length }, 200);
      } catch (error) {
        deps.logger.warn({ err: error, shop_id: shopId }, 'old logo clean-up failed');
        return c.json({ deleted: 0 }, 200);
      }
    });
}
