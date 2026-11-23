// Finishing setup on this device: register it with the server, then keep the server's copies
// of the shop, the owner's staff row and the device in Dexie. These rows are created by the
// server (POST /shops, POST /devices), so they are stored like pulled rows, not via the outbox.
import type { DeviceMode, MeResponse } from '@naqdpos/core';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { META_KEYS, type StoredDevice } from '../../db/session.ts';
import { useCurrentStaffStore, writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { syncEngine } from '../../sync/index.ts';

export type ShopEntry = MeResponse['shops'][number];

/** meta key: where to go right after setup (read once by Home). */
export const AFTER_SETUP_KEY = 'after_setup';

/** Modes offered during setup; rider devices come with the rider story. */
export type SetupMode = Extract<DeviceMode, 'owner' | 'shop'>;

/** The device name follows the chosen mode until the user types their own. */
export function defaultDeviceName(mode: SetupMode, t: (key: string) => string): string {
  return mode === 'owner' ? t('device.defaultName') : t('device.defaultNameShop');
}

/** The shop this device is set up for: the first one the user owns. */
export function ownerShop(me: MeResponse): ShopEntry | undefined {
  return me.shops.find((entry) => entry.role === 'owner');
}

/** Every shop the user owns (an owner of several shops picks one per device). */
export function ownerShops(me: MeResponse): ShopEntry[] {
  return me.shops.filter((entry) => entry.role === 'owner');
}

export async function registerThisDevice(input: {
  deviceId: string;
  shopId: string;
  name: string;
  mode: SetupMode;
  /** The owner's PIN hash when it was just set here (onboarding), so PIN switching works offline
   * before the first pull. */
  ownerPinHash?: string;
  /** Screen to open once setup is done (e.g. the produce picker); Home forwards there once. */
  next?: string;
}): Promise<void> {
  // Idempotent on the server: a retry with the same id returns the same code.
  const device = await api.registerDevice({
    id: input.deviceId,
    shop_id: input.shopId,
    name: input.name,
    mode: input.mode,
  });
  const entry = (await api.me()).shops.find((s) => s.shop.id === input.shopId);
  if (!entry) throw new Error('The new shop is not visible to this user');

  const stored: StoredDevice = {
    id: device.id,
    code: device.code,
    shop_id: input.shopId,
    mode: device.mode,
    staff_id: entry.staff?.id ?? null,
  };
  // One transaction; the `device` key goes in with the rows, so the app is never half set up.
  const now = new Date().toISOString();
  await db.transaction('rw', [db.shops, db.staff, db.staff_pins, db.devices, db.meta], async () => {
    await db.shops.put(entry.shop);
    if (entry.staff) await db.staff.put(entry.staff);
    if (entry.staff && input.ownerPinHash) {
      await db.staff_pins.put({
        staff_id: entry.staff.id,
        shop_id: input.shopId,
        pin_hash: input.ownerPinHash,
        device_id: device.id,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        server_seq: null, // the server's copy arrives with the first pull
      });
    }
    await db.devices.put(device);
    await db.meta.put({ key: META_KEYS.DEVICE, value: stored });
    // Written with the device, so whichever navigation wins (the setup gate or the form), Home
    // forwards to it.
    if (input.next) await db.meta.put({ key: AFTER_SETUP_KEY, value: input.next });
    // The owner who set the device up is the first one working on it (US016).
    if (entry.staff) await writeCurrentStaffId(entry.staff.id);
  });
  useCurrentStaffStore.setState({ staffId: entry.staff?.id ?? null, ready: true });
  // Fetch staff and PINs right away, so other staff can switch in.
  void syncEngine.syncNow();
}
