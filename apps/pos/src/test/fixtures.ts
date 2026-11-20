// Test data and Dexie helpers for component tests.
import type { DeviceRow, MeResponse, ShopRow, StaffRow } from '@naqdpos/core';
import { db } from '../db/schema.ts';
import { META_KEYS, type StoredDevice, type StoredSession } from '../db/session.ts';

export const USER_ID = '019a9b8e-0000-7000-8000-00000000000a';
export const SHOP_ID = '019a9b8e-0000-7000-8000-00000000000b';
export const STAFF_ID = '019a9b8e-0000-7000-8000-00000000000c';
export const DEVICE_ID = '019a9b8e-0000-7000-8000-00000000000d';
const NOW = '2026-11-20T10:00:00.000Z';

export function shopRow(overrides: Partial<ShopRow> = {}): ShopRow {
  return {
    id: SHOP_ID,
    name: 'Ali Fruit',
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
    server_seq: 10,
    ...overrides,
  };
}

export function staffRow(overrides: Partial<StaffRow> = {}): StaffRow {
  return {
    id: STAFF_ID,
    shop_id: SHOP_ID,
    name: 'Ali',
    phone: '+923001234567',
    role: 'owner',
    pin_hash: 'pbkdf2-sha256$1000$c2FsdA==$aGFzaA==',
    membership_user_id: USER_ID,
    active: true,
    device_id: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    server_seq: 11,
    ...overrides,
  };
}

export function deviceRow(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: DEVICE_ID,
    shop_id: SHOP_ID,
    name: 'Owner phone',
    code: 'A1',
    registered_by: USER_ID,
    last_sync_at: null,
    last_seq_pulled: 0,
    mode: 'owner',
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    server_seq: 12,
    ...overrides,
  };
}

export function me(shops: MeResponse['shops'] = []): MeResponse {
  return { user: { id: USER_ID, email: 'ali@shop.pk', name: '' }, shops };
}

export async function resetDb(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}

export async function seedSession(overrides: Partial<StoredSession> = {}): Promise<void> {
  const value: StoredSession = {
    token: 'stored-token',
    user_id: USER_ID,
    email: 'ali@shop.pk',
    checked_at: new Date().toISOString(),
    ...overrides,
  };
  await db.meta.put({ key: META_KEYS.SESSION, value });
}

/** Signed in, shop and device on this device: the app opens straight to home. */
export async function seedReady(): Promise<void> {
  await seedSession();
  await db.shops.put(shopRow());
  await db.staff.put(staffRow());
  await db.devices.put(deviceRow());
  const device: StoredDevice = {
    id: DEVICE_ID,
    code: 'A1',
    shop_id: SHOP_ID,
    mode: 'owner',
    staff_id: STAFF_ID,
  };
  await db.meta.put({ key: META_KEYS.DEVICE, value: device });
}
