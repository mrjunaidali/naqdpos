// HTTP layer (architecture §9). Routes stay thin: validate with the shared schemas, open a
// transaction as the signed-in user, call SQL, return JSON. Data rules live in SQL and RLS.
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import type { AuthService } from './auth.ts';
import type { Db } from './db/index.ts';
import { errorBody } from './errors.ts';
import type { Logger } from './logger.ts';
import { healthRoutes } from './routes/health.ts';
import { shopRoutes } from './routes/shops.ts';

export interface AppDeps {
  db: Db;
  auth: AuthService;
  logger: Logger;
  /** Allowed front-end origins (APP_ORIGINS). */
  origins: string[];
  /** True when the database answers; injected so /health is testable without Postgres. */
  checkDb: () => Promise<boolean>;
}

export interface AppEnv {
  Variables: { userId: string };
}

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({
    // Invalid input: one error shape for every route.
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues
          .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
          .join('; ');
        return c.json(errorBody('bad_request', message), 400);
      }
      return undefined;
    },
  });

  app.use(
    '*',
    cors({
      origin: deps.origins,
      allowHeaders: ['Authorization', 'Content-Type'],
      // The bearer plugin returns the session token in this header after sign-in.
      exposeHeaders: ['set-auth-token'],
      credentials: true,
    }),
  );

  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    deps.logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - start),
      },
      'request',
    );
  });

  app.on(['GET', 'POST'], '/auth/*', (c) => deps.auth.handler(c.req.raw));

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
  });
  app.route('/', healthRoutes(deps));
  app.route('/', shopRoutes(deps));
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'NaqdPOS API', version: '0.0.0' },
  });

  app.notFound((c) => c.json(errorBody('not_found'), 404));
  app.onError((error, c) => {
    deps.logger.error({ err: error, path: c.req.path }, 'unhandled error');
    return c.json(errorBody('internal'), 500);
  });

  return app;
}
