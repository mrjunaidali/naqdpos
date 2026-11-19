import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ErrorResponse, MeResponse } from '@naqdpos/core';
import type { AppDeps, AppEnv } from '../app.ts';
import { withUserTx } from '../db/index.ts';
import { toShopRow, toStaffRow } from '../db/rows.ts';
import { requireUser } from './require-user.ts';

const json = <T>(schema: T) => ({ 'application/json': { schema } });

const route = createRoute({
  method: 'get',
  path: '/me',
  summary: 'The signed-in user and the shops they belong to',
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'User and shops', content: json(MeResponse) },
    401: { description: 'Not signed in', content: json(ErrorResponse) },
  },
});

export function meRoutes(deps: Pick<AppDeps, 'db' | 'auth'>) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('/me', requireUser(deps.auth));

  return app.openapi(route, async (c) => {
    const user = c.get('user');
    // Everything is read through RLS as this user, so only their own shops come back.
    const shops = await withUserTx(deps.db, c.get('tx'), async (tx) => {
      const memberships = await tx
        .selectFrom('memberships')
        .select(['shop_id', 'role'])
        .where('user_id', '=', user.id)
        .where('deleted_at', 'is', null)
        .orderBy('created_at')
        .execute();
      if (memberships.length === 0) return [];
      const shopIds = memberships.map((m) => m.shop_id);
      const [shopRows, staffRows] = await Promise.all([
        tx.selectFrom('shops').selectAll().where('id', 'in', shopIds).execute(),
        tx
          .selectFrom('staff')
          .selectAll()
          .where('membership_user_id', '=', user.id)
          .where('deleted_at', 'is', null)
          .execute(),
      ]);
      return memberships.flatMap((m) => {
        const shop = shopRows.find((s) => s.id === m.shop_id);
        if (!shop || shop.deleted_at) return [];
        const staff = staffRows.find((s) => s.shop_id === m.shop_id);
        return [{ role: m.role, shop: toShopRow(shop), staff: staff ? toStaffRow(staff) : null }];
      });
    });
    return c.json({ user, shops }, 200);
  });
}
