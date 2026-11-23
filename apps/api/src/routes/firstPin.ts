// POST /staff/{id}/first-pin (US012): the invited owner sets their own first PIN, hashed on the
// device. owner_set_first_pin() allows only the owner linked to that staff row, and only while it
// has no PIN; admins never set or see owner PINs.
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ErrorResponse, FirstPinRequest } from '@naqdpos/core';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx } from '../db/index.ts';
import { errorBody, pgCode } from '../errors.ts';
import { requireUser } from './require-user.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });

const route = createRoute({
  method: 'post',
  path: '/staff/{id}/first-pin',
  summary: "The invited owner's first PIN",
  security: [{ bearer: [] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { required: true, content: json(FirstPinRequest) },
  },
  responses: {
    200: { description: 'Saved', content: json(z.object({ success: z.boolean() })) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
    403: { description: 'Not the linked owner', content: json(ErrorResponse) },
    409: { description: 'A PIN is already set', content: json(ErrorResponse) },
  },
});

export function firstPinRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/staff/:id/first-pin', requireUser(deps.auth));
  return app.openapi(route, async (c) => {
    const { id } = c.req.valid('param');
    const { pin_hash } = c.req.valid('json');
    try {
      await withUserTx(deps.db, c.get('tx'), (tx) =>
        sql`select owner_set_first_pin(${id}::uuid, ${pin_hash})`.execute(tx),
      );
      return c.json({ success: true }, 200);
    } catch (error) {
      if (pgCode(error) === '42501') return c.json(errorBody('forbidden'), 403);
      if (pgCode(error) === '23505')
        return c.json(errorBody('conflict', 'A PIN is already set'), 409);
      throw error;
    }
  });
}
