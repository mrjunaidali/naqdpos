// Finishing setup on this device: register it with the server, then keep the server's copies
// of the shop, the owner's staff row and the device in Dexie. These rows are created by the
// server (POST /shops, POST /devices), so they are stored like pulled rows, not via the outbox.
import type { MeResponse } from '@naqdpos/core';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { META_KEYS, type StoredDevice } from '../../db/session.ts';

type ShopEntry = MeResponse['shops'][number];

/** The shop this device is set up for: the first one the user owns (a picker comes later). */
export function ownerShop(me: MeResponse): ShopEntry | undefined {
  return me.shops.find((entry) => entry.role === 'owner');
}

export async function registerThisDevice(input: {
  deviceId: string;
  shopId: string;
  name: string;
}): Promise<void> {
  // Idempotent on the server: a retry with the same id returns the same code.
  const device = await api.registerDevice({
    id: input.deviceId,
    shop_id: input.shopId,
    name: input.name,
  });
  const entry = (await api.me()).shops.find((s) => s.shop.id === input.shopId);
  if (!entry) throw new Error('The new shop is not visible to this user');

  const stored: StoredDevice = {
    id: device.id,
    code: device.code,
    shop_id: input.shopId,
    staff_id: entry.staff?.id ?? null,
  };
  // One transaction; the `device` key goes in with the rows, so the app is never half set up.
  await db.transaction('rw', [db.shops, db.staff, db.devices, db.meta], async () => {
    await db.shops.put(entry.shop);
    if (entry.staff) await db.staff.put(entry.staff);
    await db.devices.put(device);
    await db.meta.put({ key: META_KEYS.DEVICE, value: stored });
  });
}
