import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import type { AuthService } from '../auth.ts';
import type { TxContext } from '../db/index.ts';
import { errorBody } from '../errors.ts';

const DeviceId = z.uuid();

/**
 * 401 unless the request carries a valid session. Puts the user and the transaction context
 * on `c`; a registered device sends its id as X-Device-Id, which becomes app.device_id.
 */
export function requireUser(auth: AuthService) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const deviceHeader = c.req.header('x-device-id');
    if (deviceHeader !== undefined && !DeviceId.safeParse(deviceHeader).success) {
      return c.json(errorBody('bad_request', 'X-Device-Id must be a UUID'), 400);
    }
    const user = await auth.getUser(c.req.raw.headers);
    if (!user) return c.json(errorBody('unauthorized'), 401);
    c.set('user', user);
    c.set('tx', { userId: user.id, deviceId: deviceHeader ?? null } satisfies TxContext);
    await next();
    return undefined;
  });
}
