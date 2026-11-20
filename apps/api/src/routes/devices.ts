import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { DeviceRowSchema, ErrorResponse, RegisterDeviceRequest } from '@naqdpos/core';
import { sql } from 'kysely';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx } from '../db/index.ts';
import { toDeviceRow } from '../db/rows.ts';
import type { DevicesTable } from '../db/types.ts';
import { errorBody, pgCode } from '../errors.ts';
import { requireUser } from './require-user.ts';
import type { Selectable } from 'kysely';

const json = <T>(schema: T) => ({ 'application/json': { schema } });

const route = createRoute({
  method: 'post',
  path: '/devices',
  summary: 'Register this device for a shop (owner only); the server assigns its code',
  security: [{ bearer: [] }],
  request: { body: { required: true, content: json(RegisterDeviceRequest) } },
  responses: {
    201: {
      description: 'Registered, or a retry of an earlier success',
      content: json(DeviceRowSchema),
    },
    400: { description: 'Invalid input', content: json(ErrorResponse) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
    403: { description: 'Not the owner of this shop', content: json(ErrorResponse) },
    409: { description: 'Device id belongs to another shop', content: json(ErrorResponse) },
  },
});

export function deviceRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/devices', requireUser(deps.auth));

  return app.openapi(route, async (c) => {
    const body = c.req.valid('json');
    try {
      // register_device checks the owner role, locks the shop and picks the next code (SQL).
      const row = await withUserTx(deps.db, c.get('tx'), async (tx) => {
        const { rows } = await sql<Selectable<DevicesTable>>`
          select * from register_device(${body.id}, ${body.shop_id}, ${body.name}, ${body.mode})`.execute(
          tx,
        );
        return rows[0]!;
      });
      return c.json(toDeviceRow(row), 201);
    } catch (error) {
      const code = pgCode(error);
      if (code === '42501') return c.json(errorBody('forbidden'), 403);
      if (code === '23505') return c.json(errorBody('conflict', 'device id already in use'), 409);
      if (code === '23514') return c.json(errorBody('bad_request'), 400);
      throw error;
    }
  });
}
