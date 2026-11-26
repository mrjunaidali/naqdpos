// HTTP layer (architecture §9). Routes stay thin: validate with the shared schemas, open a
// transaction as the signed-in user, call SQL, return JSON. Data rules live in SQL and RLS.
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import type { AuthService, AuthUser } from './auth.ts';
import type { Db, TxContext } from './db/index.ts';
import { errorBody, pgDetails } from './errors.ts';
import type { Logger } from './logger.ts';
import type { Mailer } from './mailer.ts';
import type { ObjectStore } from './storage.ts';
import { fileRoutes } from './routes/files.ts';
import { configRoutes } from './routes/config.ts';
import { deviceRoutes } from './routes/devices.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { pinRoutes } from './routes/pins.ts';
import { adminRoutes } from './routes/admin.ts';
import { firstPinRoutes } from './routes/firstPin.ts';
import { reportRoutes } from './routes/reports.ts';
import { shopRoutes } from './routes/shops.ts';
import { syncRoutes } from './routes/sync.ts';

export interface AppDeps {
  db: Db;
  auth: AuthService;
  logger: Logger;
  /** Allowed front-end origins (APP_ORIGINS). */
  origins: string[];
  /** True when the database answers; injected so /health is testable without Postgres. */
  checkDb: () => Promise<boolean>;
  /** MIN_APP_VERSION: older apps get 426 on /sync/*. Unset = accept every version. */
  minAppVersion?: string | undefined;
  /** Object storage (S3_*); null = file features off (local dev). */
  files?: ObjectStore | null;
  /** Mailer (owner invite emails); null = not configured. */
  mailer?: Mailer | null;
  /** The shop app's address for invite emails (POS_URL). */
  posUrl?: string | undefined;
}

export interface AppEnv {
  /** Set by requireUser on routes that need a session. */
  Variables: { user: AuthUser; tx: TxContext } & RequestIdVariables;
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

  // Every request gets an id (an incoming X-Request-Id is kept): in the log lines, the
  // X-Request-Id response header and the 500 body, so a user's error matches its log line.
  app.use('*', requestId());

  app.use(
    '*',
    cors({
      origin: deps.origins,
      allowHeaders: ['Authorization', 'Content-Type', 'X-Device-Id', 'X-App-Version'],
      // The bearer plugin returns the session token in this header after sign-in.
      exposeHeaders: ['set-auth-token', 'X-Request-Id'],
      credentials: true,
    }),
  );

  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    deps.logger.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - start),
      },
      'request',
    );
  });

  // Google returns here; the app gets a single-use token in the redirect (auth.ts).
  app.get('/auth/callback/*', (c) => deps.auth.handleOAuthCallback(c.req.raw));
  app.on(['GET', 'POST'], '/auth/*', (c) => deps.auth.handler(c.req.raw));

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
  });
  app.route('/', healthRoutes(deps));
  app.route('/', configRoutes(deps));
  app.route('/', meRoutes(deps));
  app.route('/', shopRoutes(deps));
  app.route('/', deviceRoutes(deps));
  app.route('/', syncRoutes(deps));
  app.route('/', pinRoutes(deps));
  app.route('/', adminRoutes(deps));
  app.route('/', firstPinRoutes(deps));
  app.route('/', reportRoutes(deps));
  app.route('/', fileRoutes(deps));
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'NaqdPOS API', version: '0.0.0' },
  });

  app.notFound((c) => c.json(errorBody('not_found'), 404));
  app.onError((error, c) => {
    const id = c.get('requestId');
    deps.logger.error(
      { err: error, requestId: id, method: c.req.method, path: c.req.path, pg: pgDetails(error) },
      'unhandled error',
    );
    return c.json({ ...errorBody('internal'), request_id: id }, 500);
  });

  return app;
}
