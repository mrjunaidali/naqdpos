import type { DeviceRow, ShopRow, StaffRow } from '@naqdpos/core';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { NaqdDb } from './schema.ts';

const SHOP_ID = '01937e5a-0000-7000-8000-000000000001';
const NOW = '2026-11-18T10:00:00.000Z';

const shop: ShopRow = {
  id: SHOP_ID,
  name: 'Bilal Fruits',
  type: 'fruit_veg',
  address: null,
  phone: '+923001234567',
  receipt_footer: null,
  logo_path: null,
  status: 'active',
  plan_id: null,
  timezone: 'Asia/Karachi',
  cashier_expense_limit_paisa: 200_000,
  device_id: null,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  server_seq: 1,
};

function staffRow(id: string, shopId: string, active: boolean, serverSeq: number | null): StaffRow {
  return {
    id,
    shop_id: shopId,
    name: `Staff ${id.slice(-1)}`,
    phone: null,
    role: 'cashier',
    pin_hash: null,
    membership_user_id: null,
    active,
    device_id: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    server_seq: serverSeq,
  };
}

const device: DeviceRow = {
  id: '01937e5a-0000-7000-8000-0000000000d1',
  shop_id: SHOP_ID,
  name: 'Counter',
  code: 'A1',
  registered_by: null,
  last_sync_at: null,
  last_seq_pulled: 0,
  mode: 'shop',
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  server_seq: 3,
};

describe('NaqdDb schema', () => {
  const opened: Dexie[] = [];
  function track<T extends Dexie>(database: T): T {
    opened.push(database);
    return database;
  }

  afterEach(async () => {
    for (const database of opened.splice(0)) {
      database.close();
      await database.delete();
    }
  });

  it('is version 5 with the tenancy, sync and catalogue tables', async () => {
    const db = track(new NaqdDb('naqdpos-test-schema'));
    await db.open();
    expect(db.verno).toBe(5);
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'categories',
      'devices',
      'meta',
      'outbox',
      'price_history',
      'product_cost_history',
      'product_costs',
      'products',
      'shops',
      'staff',
      'staff_pins',
      'staff_salaries',
      'sync_errors',
    ]);
    const indexNames = (name: string) =>
      db
        .table(name)
        .schema.indexes.map((index) => index.name)
        .sort();
    expect(indexNames('outbox')).toEqual(['row_key', 'table']);
    expect(indexNames('staff_salaries')).toEqual(['server_seq', 'shop_id']);
  });

  it('does not store server-only tables', async () => {
    const db = track(new NaqdDb('naqdpos-test-no-private'));
    await db.open();
    const names = db.tables.map((table) => table.name);
    for (const name of ['memberships', 'platform_admins', 'audit_log', 'sync_conflicts']) {
      expect(names).not.toContain(name);
    }
  });

  it('upgrades a version 2 database to the current version without losing rows', async () => {
    const name = 'naqdpos-test-upgrade-v3';
    const v2 = track(new Dexie(name));
    v2.version(1).stores({ meta: 'key' });
    v2.version(2).stores({
      shops: 'id, server_seq',
      staff: 'id, shop_id, server_seq',
      devices: 'id, shop_id, server_seq',
    });
    await v2.table('shops').put(shop);
    await v2.table('meta').put({ key: 'device', value: { id: device.id } });
    v2.close();

    const db = track(new NaqdDb(name));
    await db.open();
    expect(db.verno).toBe(5);
    expect(await db.shops.get(SHOP_ID)).toEqual(shop);
    expect(await db.meta.get('device')).toEqual({ key: 'device', value: { id: device.id } });
    expect(await db.outbox.count()).toBe(0);
  });

  it('indexes shop_id and server_seq for sync and lookups', async () => {
    const db = track(new NaqdDb('naqdpos-test-indexes'));
    await db.open();
    const indexNames = (name: string) =>
      db
        .table(name)
        .schema.indexes.map((index) => index.name)
        .sort();
    expect(indexNames('shops')).toEqual(['server_seq']);
    expect(indexNames('staff')).toEqual(['server_seq', 'shop_id']);
    expect(indexNames('devices')).toEqual(['server_seq', 'shop_id']);
  });

  it('stores and reads meta values by key', async () => {
    const db = track(new NaqdDb('naqdpos-test-meta'));
    await db.meta.put({ key: 'storage_persisted', value: true });
    expect(await db.meta.get('storage_persisted')).toEqual({
      key: 'storage_persisted',
      value: true,
    });
  });

  it('stores tenancy rows and finds a shop’s staff by shop_id', async () => {
    const db = track(new NaqdDb('naqdpos-test-tenancy'));
    await db.shops.put(shop);
    await db.devices.put(device);
    await db.staff.bulkPut([
      staffRow('01937e5a-0000-7000-8000-0000000000a1', SHOP_ID, true, 2),
      staffRow('01937e5a-0000-7000-8000-0000000000a2', SHOP_ID, false, null),
      staffRow(
        '01937e5a-0000-7000-8000-0000000000b1',
        '01937e5a-0000-7000-8000-000000000002',
        true,
        4,
      ),
    ]);

    expect(await db.shops.get(SHOP_ID)).toEqual(shop);
    expect(await db.devices.where('shop_id').equals(SHOP_ID).first()).toEqual(device);
    const shopStaff = await db.staff.where('shop_id').equals(SHOP_ID).toArray();
    expect(shopStaff.map((row) => row.id).sort()).toEqual([
      '01937e5a-0000-7000-8000-0000000000a1',
      '01937e5a-0000-7000-8000-0000000000a2',
    ]);
    expect(shopStaff.filter((row) => row.active)).toHaveLength(1);
    // Pull cursor query: rows newer than a given server_seq.
    expect(await db.staff.where('server_seq').above(2).primaryKeys()).toEqual([
      '01937e5a-0000-7000-8000-0000000000b1',
    ]);
  });

  it('upgrades a version 1 database without losing meta', async () => {
    const name = 'naqdpos-test-upgrade';
    const v1 = track(new Dexie(name));
    v1.version(1).stores({ meta: 'key' });
    await v1.table('meta').put({ key: 'storage_persisted', value: false });
    v1.close();

    const db = track(new NaqdDb(name));
    await db.open();
    expect(db.verno).toBe(5);
    expect(await db.meta.get('storage_persisted')).toEqual({
      key: 'storage_persisted',
      value: false,
    });
    expect(await db.shops.count()).toBe(0);
  });
});
