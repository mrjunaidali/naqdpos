// Changing this device's mode after setup (owner phone ↔ shop counter). The mode decides what the
// device may pull and push (architecture §4), so:
//   - only with an empty outbox (an online sync first): pending entries could otherwise be
//     refused under the new mode;
//   - the server changes first (owner only, audit-logged); nothing changes locally if it fails;
//   - then one Dexie transaction: the device row and meta.device.mode, the pull cursor back to 0
//     (shop → owner: owner-only rows such as costs and salaries get pulled; they were skipped
//     before), and on owner → shop the owner-only stores are emptied.
import { OWNER_DEVICE_TABLES, type DeviceRow } from '@naqdpos/core';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice, META_KEYS, type StoredDevice } from '../../db/session.ts';
import { syncEngine } from '../../sync/index.ts';
import { SYNC_META } from '../../sync/state.ts';
import type { SetupMode } from '../onboarding/setup.ts';
import { UnsyncedChangesError } from '../settings/signOut.ts';

export async function changeDeviceMode(mode: SetupMode): Promise<DeviceRow> {
  const device = await getStoredDevice();
  if (!device) throw new Error('This device is not set up');
  const pending = await db.outbox.count();
  if (pending > 0) throw new UnsyncedChangesError(pending);

  const row = await api.setDeviceMode(device.id, mode);

  const ownerOnly = OWNER_DEVICE_TABLES.map((name) => db.table(name));
  await db.transaction('rw', [db.devices, db.meta, db.report_cache, ...ownerOnly], async () => {
    await db.devices.put(row);
    const stored: StoredDevice = { ...device, mode: row.mode };
    await db.meta.put({ key: META_KEYS.DEVICE, value: stored });
    if (row.mode !== 'owner') {
      for (const table of ownerOnly) await table.clear();
      // Cached reports hold costs and profit: owner devices only (architecture §5).
      await db.report_cache.clear();
    }
    // Pull everything again under the new mode (puts are idempotent).
    await db.meta.put({ key: SYNC_META.CURSOR, value: 0 });
  });
  void syncEngine.syncNow();
  return row;
}
