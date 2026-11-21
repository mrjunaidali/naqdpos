import type { ShopProfileValue } from '@naqdpos/core';
import { localWriteMany } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

/** Saves the shop profile (owner only; column grants, RLS and write_roles on the server too). */
export async function saveShopProfile(value: ShopProfileValue, actorStaffId: string) {
  const device = await getStoredDevice();
  const shop = device ? await db.shops.get(device.shop_id) : undefined;
  if (!shop) throw new Error('no shop');
  await localWriteMany(
    [
      {
        table: 'shops',
        op: 'upsert',
        row: { ...shop, ...value, updated_at: new Date().toISOString() },
      },
    ],
    db,
    { actorStaffId },
  );
}
