import { localWriteMany } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

/** Saves the shop's cashier discount limit (owner only; RLS + write_roles on the server too). */
export async function saveDiscountLimit(pct: number, actorStaffId: string) {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new RangeError('pct');
  const device = await getStoredDevice();
  const shop = device ? await db.shops.get(device.shop_id) : undefined;
  if (!shop) throw new Error('no shop');
  await localWriteMany(
    [
      {
        table: 'shops',
        op: 'upsert',
        row: { ...shop, cashier_max_discount_pct: pct, updated_at: new Date().toISOString() },
      },
    ],
    db,
    { actorStaffId },
  );
}
