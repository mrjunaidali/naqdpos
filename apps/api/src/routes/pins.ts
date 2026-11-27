// Owner PIN reset by email code (architecture §5). Two steps, always for the session's own email:
//   POST /staff/{id}/pin-code  → checks who may reset and the send limits, emails a code
//   POST /staff/{id}/pin       → checks (and uses up) the code, saves the new PIN hash
// Not a sync write: the server must see the code. The device stores the returned row itself.
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  APP_LANGUAGE_HEADER,
  can,
  emailLanguage,
  ErrorResponse,
  PinResetCodeResponse,
  ResetOwnerPinRequest,
  StaffPinRowSchema,
} from '@naqdpos/core';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../app.ts';
import type { TxContext } from '../db/index.ts';
import { withUserTx, type Tx } from '../db/index.ts';
import { shopRole } from '../db/roles.ts';
import { toStaffPinRow, type StaffPinDbRow } from '../db/rows.ts';
import { errorBody, pgCode } from '../errors.ts';
import { requireUser } from './require-user.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const params = z.object({ id: z.uuid() });
const errors = {
  400: { description: 'Invalid input, or a wrong or expired code', content: json(ErrorResponse) },
  401: { description: 'Not signed in', content: json(ErrorResponse) },
  403: {
    description: 'Not your own active owner staff row in a shop you own',
    content: json(ErrorResponse),
  },
  429: {
    description: 'Too many wrong codes, or codes requested too often',
    content: json(ErrorResponse),
  },
};

const codeRoute = createRoute({
  method: 'post',
  path: '/staff/{id}/pin-code',
  summary: 'Email a PIN reset code to the signed-in owner',
  security: [{ bearer: [] }],
  request: { params },
  responses: { 200: { description: 'Code sent', content: json(PinResetCodeResponse) }, ...errors },
});

const pinRoute = createRoute({
  method: 'post',
  path: '/staff/{id}/pin',
  summary: 'Check the emailed code and save the new PIN',
  security: [{ bearer: [] }],
  request: { params, body: { required: true, content: json(ResetOwnerPinRequest) } },
  responses: {
    200: { description: 'The new PIN row', content: json(StaffPinRowSchema) },
    ...errors,
  },
});

/**
 * Route-level check (rule 7, with the same rule again in SQL): the staff row is an active owner
 * linked to this user, in a shop where the user may manage staff.
 */
async function mayReset(tx: Tx, staffId: string, userId: string): Promise<boolean> {
  const { rows } = await sql<{
    shop_id: string;
    role: string;
    active: boolean;
    deleted_at: Date | null;
    membership_user_id: string | null;
  }>`select shop_id, role, active, deleted_at, membership_user_id from staff where id = ${staffId}`.execute(
    tx,
  );
  const staff = rows[0];
  if (!staff) return false;
  return (
    staff.role === 'owner' &&
    staff.active &&
    staff.deleted_at === null &&
    staff.membership_user_id === userId &&
    can(await shopRole(tx, staff.shop_id), 'manage_staff')
  );
}

export function pinRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/staff/*', requireUser(deps.auth));

  const inTx = <T>(context: TxContext, fn: (tx: Tx) => Promise<T>) =>
    withUserTx(deps.db, context, fn).catch((error: unknown) => {
      if (pgCode(error) === '42501') return 'forbidden' as const;
      throw error;
    });

  app.openapi(codeRoute, async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    const outcome = await inTx(c.get('tx'), async (tx) => {
      if (!(await mayReset(tx, id, user.id))) return 'forbidden' as const;
      const { rows } = await sql<{ r: 'ok' | 'cooldown' | 'daily_cap' }>`
        select request_pin_reset_code(${id}) as r`.execute(tx);
      const result = rows[0]!.r;
      // Sent inside the transaction: if sending fails, the send is not counted.
      if (result === 'ok')
        await deps.auth.sendPinResetCode(
          user.email,
          emailLanguage(c.req.header(APP_LANGUAGE_HEADER)),
        );
      return result;
    });
    if (outcome === 'forbidden') return c.json(errorBody('forbidden'), 403);
    if (outcome === 'cooldown') {
      return c.json(
        errorBody('code_cooldown', 'Wait a minute before asking for another code'),
        429,
      );
    }
    if (outcome === 'daily_cap') {
      return c.json(errorBody('code_daily_cap', 'At most 10 codes a day'), 429);
    }
    return c.json({ sent: true as const }, 200);
  });

  app.openapi(pinRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { code, pin_hash } = c.req.valid('json');
    const user = c.get('user');
    const outcome = await inTx(c.get('tx'), async (tx) => {
      // Checked before the code, so someone not allowed never uses up an owner's code.
      if (!(await mayReset(tx, id, user.id))) return 'forbidden' as const;
      const check = await deps.auth.verifyPinResetCode(user.email, code);
      if (check !== 'ok') return check;
      const { rows } = await sql<StaffPinDbRow>`
        select * from reset_owner_pin(${id}, ${pin_hash})`.execute(tx);
      return toStaffPinRow(rows[0]!);
    });
    if (outcome === 'forbidden') return c.json(errorBody('forbidden'), 403);
    if (outcome === 'invalid') return c.json(errorBody('invalid_code'), 400);
    if (outcome === 'expired') return c.json(errorBody('code_expired'), 400);
    if (outcome === 'too_many') return c.json(errorBody('too_many_attempts'), 429);
    return c.json(outcome, 200);
  });

  return app;
}
