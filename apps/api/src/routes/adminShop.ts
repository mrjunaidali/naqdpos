// Admin creates shops, invites owners (US012) and acts as a shop (US013). Every write goes
// through a security-definer SQL function that checks is_platform_admin() and audits with
// acting_as_admin = true; these routes stay thin. Registered on the guarded admin app.
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminCatalogue,
  AdminCategoryInput,
  AdminCreateShopRequest,
  AdminCreateShopResponse,
  AdminImportRequest,
  AdminImportResponse,
  AdminInviteRequest,
  AdminProductInput,
  AdminStaffInput,
  ErrorResponse,
  IdResponse,
  OWNER_JOINED_MESSAGE,
} from '@naqdpos/core';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx, type TxContext } from '../db/index.ts';
import { errorBody, pgCode } from '../errors.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const shopParam = z.object({ id: z.uuid() });
const errors = {
  400: { description: 'Invalid', content: json(ErrorResponse) },
  401: { description: 'Not signed in', content: json(ErrorResponse) },
  403: { description: 'Not allowed', content: json(ErrorResponse) },
  404: { description: 'Not found', content: json(ErrorResponse) },
  409: { description: 'Conflict', content: json(ErrorResponse) },
};
const post = <P extends z.ZodObject, B extends z.ZodType, R extends z.ZodType>(
  path: string,
  params: P,
  body: B,
  response: R,
  summary: string,
) =>
  createRoute({
    method: 'post',
    path,
    summary,
    security: [{ bearer: [] }],
    request: { params, body: { required: true, content: json(body) } },
    responses: { 200: { description: 'Done', content: json(response) }, ...errors },
  });

const success = z.object({ success: z.boolean() });
const createShop = post(
  '/admin/shops',
  z.object({}),
  AdminCreateShopRequest,
  AdminCreateShopResponse,
  'Create a shop and invite its owner',
);
const catalogue = createRoute({
  method: 'get',
  path: '/admin/shops/{id}/catalogue',
  summary: 'Categories, products and invites of a shop',
  security: [{ bearer: [] }],
  request: { params: shopParam },
  responses: { 200: { description: 'Catalogue', content: json(AdminCatalogue) }, ...errors },
});
const createInvite = post(
  '/admin/shops/{id}/invites',
  shopParam,
  AdminInviteRequest,
  IdResponse,
  'Invite the owner again',
);
const revokeInvite = post(
  '/admin/invites/{id}/revoke',
  shopParam,
  z.object({}),
  success,
  'Revoke a pending invite',
);
const saveProduct = post(
  '/admin/shops/{id}/products',
  shopParam,
  AdminProductInput,
  IdResponse,
  'Add or edit a product',
);
const hideProduct = post(
  '/admin/shops/{id}/products/{pid}/hide',
  z.object({ id: z.uuid(), pid: z.uuid() }),
  z.object({ hidden: z.boolean() }),
  success,
  'Hide or restore a product',
);
const importProducts = post(
  '/admin/shops/{id}/products/import',
  shopParam,
  AdminImportRequest,
  AdminImportResponse,
  'Import products (CSV or fresh produce list)',
);
const saveCategory = post(
  '/admin/shops/{id}/categories',
  shopParam,
  AdminCategoryInput,
  IdResponse,
  'Add, rename or sort a category',
);
const saveStaff = post(
  '/admin/shops/{id}/staff',
  shopParam,
  AdminStaffInput,
  IdResponse,
  'Add or change a cashier or rider',
);

type AdminEnv = AppEnv & { Variables: { sessionId: string } };
type Failure = { ok: false; status: 400 | 403 | 404 | 409; body: ErrorResponse };

export function registerAdminShopRoutes(app: OpenAPIHono<AdminEnv>, deps: Pick<AppDeps, 'db'>) {
  /** Runs one admin function as the signed-in admin and maps SQL errors to HTTP. */
  const call = async (
    context: TxContext,
    query: RawBuilder<{ r: unknown }>,
  ): Promise<{ ok: true; value: unknown } | Failure> => {
    try {
      const rows = await withUserTx(deps.db, context, async (tx) => (await query.execute(tx)).rows);
      return { ok: true, value: rows[0]?.r };
    } catch (error) {
      const code = pgCode(error) ?? '';
      if (code === '42501') return { ok: false, status: 403, body: errorBody('forbidden') };
      if (code === 'NQ001')
        return { ok: false, status: 409, body: errorBody('owner_joined', OWNER_JOINED_MESSAGE) };
      if (code === 'P0002') return { ok: false, status: 404, body: errorBody('not_found') };
      if (code === '23505') return { ok: false, status: 409, body: errorBody('conflict') };
      if (code.startsWith('22') || code.startsWith('23'))
        return { ok: false, status: 400, body: errorBody('bad_request') };
      throw error;
    }
  };
  const asJson = (v: unknown) => JSON.stringify(v);

  app
    .openapi(createShop, async (c) => {
      const r = await call(
        c.get('tx'),
        sql`select admin_create_shop(${asJson(c.req.valid('json'))}::jsonb) as r`,
      );
      return r.ok ? c.json(AdminCreateShopResponse.parse(r.value), 200) : c.json(r.body, r.status);
    })
    .openapi(catalogue, async (c) => {
      const r = await call(
        c.get('tx'),
        sql`select admin_shop_catalogue(${c.req.valid('param').id}::uuid) as r`,
      );
      return r.ok ? c.json(AdminCatalogue.parse(r.value), 200) : c.json(r.body, r.status);
    })
    .openapi(createInvite, async (c) => {
      const r = await call(
        c.get('tx'),
        sql`select admin_create_invite(${c.req.valid('param').id}::uuid, ${c.req.valid('json').email}) as r`,
      );
      return r.ok ? c.json({ id: String(r.value) }, 200) : c.json(r.body, r.status);
    })
    .openapi(revokeInvite, async (c) => {
      const r = await call(
        c.get('tx'),
        sql`select admin_revoke_invite(${c.req.valid('param').id}::uuid) as r`,
      );
      return r.ok ? c.json({ success: true }, 200) : c.json(r.body, r.status);
    })
    .openapi(saveProduct, async (c) => {
      const r = await call(
        c.get('tx'),
        sql`select admin_save_product(${c.req.valid('param').id}::uuid, ${asJson(c.req.valid('json'))}::jsonb) as r`,
      );
      return r.ok ? c.json({ id: String(r.value) }, 200) : c.json(r.body, r.status);
    })
    .openapi(hideProduct, async (c) => {
      const p = c.req.valid('param');
      const r = await call(
        c.get('tx'),
        sql`select admin_hide_product(${p.id}::uuid, ${p.pid}::uuid, ${c.req.valid('json').hidden}) as r`,
      );
      return r.ok ? c.json({ success: true }, 200) : c.json(r.body, r.status);
    })
    .openapi(importProducts, async (c) => {
      const body = c.req.valid('json');
      const r = await call(
        c.get('tx'),
        sql`select admin_import_products(${c.req.valid('param').id}::uuid, ${asJson(body.rows)}::jsonb, ${body.on_existing}) as r`,
      );
      return r.ok ? c.json(AdminImportResponse.parse(r.value), 200) : c.json(r.body, r.status);
    })
    .openapi(saveCategory, async (c) => {
      const r = await call(
        c.get('tx'),
        sql`select admin_save_category(${c.req.valid('param').id}::uuid, ${asJson(c.req.valid('json'))}::jsonb) as r`,
      );
      return r.ok ? c.json({ id: String(r.value) }, 200) : c.json(r.body, r.status);
    })
    .openapi(saveStaff, async (c) => {
      const { pin_hash, ...staff } = c.req.valid('json');
      const r = await call(
        c.get('tx'),
        sql`select admin_save_staff(${c.req.valid('param').id}::uuid, ${asJson(staff)}::jsonb, ${pin_hash ?? null}) as r`,
      );
      return r.ok ? c.json({ id: String(r.value) }, 200) : c.json(r.body, r.status);
    });
}
