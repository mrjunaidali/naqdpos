import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ConfigResponse } from '@naqdpos/core';
import type { AppDeps, AppEnv } from '../app.ts';

const route = createRoute({
  method: 'get',
  path: '/config',
  summary: 'Sign-in options the apps may offer',
  responses: {
    200: { description: 'Options', content: { 'application/json': { schema: ConfigResponse } } },
  },
});

export function configRoutes(deps: Pick<AppDeps, 'auth'>) {
  return new OpenAPIHono<AppEnv>().openapi(route, (c) =>
    c.json({ google: deps.auth.googleEnabled }, 200),
  );
}
