import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  can,
  DeviceRowSchema,
  ErrorResponse,
  RegisterDeviceRequest,
  SetDeviceModeRequest,
} from '@naqdpos/core';
import { z } from 'zod';
import { sql } from 'kysely';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx } from '../db/index.ts';
import { shopRole } from '../db/roles.ts';
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

const modeRoute = createRoute({
  method: 'post',
  path: '/devices/{id}/mode',
  summary: 'Switch a device between owner phone and shop counter (owner only, audit-logged)',
  security: [{ bearer: [] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { required: true, content: json(SetDeviceModeRequest) },
  },
  responses: {
    200: { description: 'The device with its mode', content: json(DeviceRowSchema) },
    400: { description: 'Invalid input', content: json(ErrorResponse) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
    403: {
      description: "Not the owner of the device's shop (or no such device)",
      content: json(ErrorResponse),
    },
  },
});

export function deviceRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/devices', requireUser(deps.auth));
  app.use('/devices/*', requireUser(deps.auth));

  app.openapi(modeRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { mode } = c.req.valid('json');
    // Both layers (rule 7): can() on the caller's role in the device's shop, then
    // set_device_mode checks the owner role again and writes the audit row.
    const row = await withUserTx(deps.db, c.get('tx'), async (tx) => {
      const { rows: found } = await sql<{ shop_id: string }>`
        select shop_id from devices where id = ${id} and deleted_at is null`.execute(tx);
      const shopId = found[0]?.shop_id;
      if (!shopId || !can(await shopRole(tx, shopId), 'manage_devices')) return null;
      const { rows } = await sql<Selectable<DevicesTable>>`
        select * from set_device_mode(${id}, ${mode})`.execute(tx);
      return rows[0]!;
    }).catch((error: unknown) => {
      if (pgCode(error) === '42501') return null;
      throw error;
    });
    if (!row) return c.json(errorBody('forbidden'), 403);
    return c.json(toDeviceRow(row), 200);
  });

  return app.openapi(route, async (c) => {
    const body = c.req.valid('json');
    try {
      // Both layers (CLAUDE.md rule 7): the route checks can(), and register_device checks the
      // owner role again, locks the shop and picks the next code (SQL).
      const row = await withUserTx(deps.db, c.get('tx'), async (tx) => {
        if (!can(await shopRole(tx, body.shop_id), 'manage_devices')) return null;
        const { rows } = await sql<Selectable<DevicesTable>>`
          select * from register_device(${body.id}, ${body.shop_id}, ${body.name}, ${body.mode})`.execute(
          tx,
        );
        return rows[0]!;
      });
      if (!row) return c.json(errorBody('forbidden'), 403);
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
