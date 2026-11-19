import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { HealthResponse } from '@naqdpos/core';
import type { AppDeps, AppEnv } from '../app.ts';

const route = createRoute({
  method: 'get',
  path: '/health',
  summary: 'Liveness and database check',
  responses: {
    200: {
      description: 'API and database are up',
      content: { 'application/json': { schema: HealthResponse } },
    },
    503: {
      description: 'Database is down',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

export function healthRoutes(deps: Pick<AppDeps, 'checkDb'>) {
  return new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
    const db = await deps.checkDb();
    return db ? c.json({ ok: true, db }, 200) : c.json({ ok: false, db }, 503);
  });
}
