import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app.ts';
import type { AuthService } from '../auth.ts';
import { errorBody } from '../errors.ts';

/** 401 unless the request carries a valid session; puts the user id on the context. */
export function requireUser(auth: AuthService) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = await auth.getUserId(c.req.raw.headers);
    if (!userId) return c.json(errorBody('unauthorized'), 401);
    c.set('userId', userId);
    await next();
    return undefined;
  });
}
