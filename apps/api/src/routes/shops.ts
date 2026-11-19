import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { CreateShopRequest, CreateShopResponse, ErrorResponse } from '@naqdpos/core';
import { sql } from 'kysely';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx } from '../db/index.ts';
import { errorBody, pgCode } from '../errors.ts';
import { requireUser } from './require-user.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });

const createShop = createRoute({
  method: 'post',
  path: '/shops',
  summary: 'Create a shop with the caller as owner (onboarding)',
  security: [{ bearer: [] }],
  request: { body: { required: true, content: json(CreateShopRequest) } },
  responses: {
    201: {
      description: 'Created, or a retry of an earlier success',
      content: json(CreateShopResponse),
    },
    400: { description: 'Invalid input', content: json(ErrorResponse) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
    409: { description: 'Shop id belongs to another user', content: json(ErrorResponse) },
  },
});

export function shopRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/shops', requireUser(deps.auth));

  return app.openapi(createShop, async (c) => {
    const body = c.req.valid('json');
    try {
      // create_shop does shop + owner membership + owner staff (with PIN hash) + audit row in
      // one transaction.
      const id = await withUserTx(deps.db, c.get('tx'), async (tx) => {
        const { rows } = await sql<{ id: string }>`
          select create_shop(
            ${body.shop_id}, ${body.name}, ${body.type}, ${body.owner_staff_id},
            ${body.owner_name}, ${body.owner_phone}, ${body.shop_phone}, ${body.owner_pin_hash},
            ${body.address ?? null}, ${body.device_id ?? null}
          ) as id`.execute(tx);
        return rows[0]!.id;
      });
      return c.json({ id }, 201);
    } catch (error) {
      const code = pgCode(error);
      // 23505: shop id taken by someone else, or the owner staff id is already used.
      if (code === '23505') return c.json(errorBody('conflict', 'id already in use'), 409);
      // 23514: a check constraint the schema did not catch.
      if (code === '23514') return c.json(errorBody('bad_request'), 400);
      throw error;
    }
  });
}
