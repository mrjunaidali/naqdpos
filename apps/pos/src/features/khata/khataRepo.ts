// Customers and khata on the device (US038–US041): reads from Dexie, writes through the outbox.
import {
  buildKhataAdjustment,
  buildKhataReceipt,
  customerId,
  khataBalance,
  normalizePkMobile,
  type CustomerRow,
  type KhataEntryRow,
  type PaymentRow,
  type StaffRow,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { localWriteMany } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

export class KhataNotSaved extends Error {
  constructor(readonly reason: string) {
    super(`Khata not saved: ${reason}`);
    this.name = 'KhataNotSaved';
  }
}

async function shopDevice() {
  const device = await getStoredDevice();
  if (!device) throw new KhataNotSaved('no_device');
  return device;
}

export function useCustomers(): CustomerRow[] | undefined {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    if (!device) return [];
    return (await db.customers.where('shop_id').equals(device.shop_id).toArray()).filter(
      (c) => c.deleted_at === null,
    );
  });
}

export function useCustomer(id: string | null | undefined): CustomerRow | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.customers.get(id)) ?? null) : null), [id]);
}

/** Every customer's balance (sum of their entries); a customer with no entries has 0. */
export function useBalances(): Map<string, KhataEntryRow[]> | undefined {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    const byCustomer = new Map<string, KhataEntryRow[]>();
    if (!device) return byCustomer;
    await db.khata_entries
      .where('shop_id')
      .equals(device.shop_id)
      .each((e) => {
        const list = byCustomer.get(e.customer_id) ?? [];
        list.push(e);
        byCustomer.set(e.customer_id, list);
      });
    return byCustomer;
  });
}

export function useKhataEntries(id: string | null | undefined): KhataEntryRow[] | undefined {
  return useLiveQuery(
    async () => (id ? db.khata_entries.where('customer_id').equals(id).toArray() : []),
    [id],
  );
}

export async function customerBalance(id: string) {
  return khataBalance(await db.khata_entries.where('customer_id').equals(id).toArray());
}

/**
 * Adds a customer by mobile, or returns the one that already has it (the id is UUIDv5 of the
 * shop and the mobile, so the same number is the same customer on every device).
 */
export async function findOrAddCustomer(
  mobile: string,
  name: string | null,
  actorStaffId: string | null,
): Promise<CustomerRow> {
  const device = await shopDevice();
  const e164 = normalizePkMobile(mobile);
  const id = e164 ? await customerId(device.shop_id, e164) : null;
  if (!e164 || !id) throw new KhataNotSaved('bad_mobile');
  const existing = await db.customers.get(id);
  const cleanName = name?.trim() || null;
  if (existing && existing.deleted_at === null) {
    // Picking an existing number with a name typed fills a missing name, never overwrites one.
    if (cleanName && !existing.name)
      return updateCustomer(existing, { name: cleanName }, actorStaffId);
    return existing;
  }
  const now = new Date().toISOString();
  const row: CustomerRow = {
    id,
    shop_id: device.shop_id,
    mobile: e164,
    name: cleanName,
    address: null,
    credit_limit_paisa: null,
    whatsapp_opt_in: false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    device_id: device.id,
    server_seq: existing?.server_seq ?? null,
  };
  await localWriteMany([{ table: 'customers', op: 'upsert', row: { ...row } }], db, {
    actorStaffId,
  });
  return row;
}

/** Name and address only: the mobile never changes (a new number is a new customer). */
export async function updateCustomer(
  customer: CustomerRow,
  fields: { name?: string | null; address?: string | null },
  actorStaffId: string | null,
): Promise<CustomerRow> {
  const row: CustomerRow = {
    ...customer,
    ...(fields.name !== undefined && { name: fields.name?.trim() || null }),
    ...(fields.address !== undefined && { address: fields.address?.trim() || null }),
    updated_at: new Date().toISOString(),
  };
  await localWriteMany([{ table: 'customers', op: 'upsert', row: { ...row } }], db, {
    actorStaffId,
  });
  return row;
}

/** "Receive payment" (US040): the payment and its khata entry in one transaction. */
export async function receiveKhataPayment(
  customer: CustomerRow,
  amountPaisa: number,
  methodCode: string,
  reference: string | null,
  staff: StaffRow,
): Promise<{ payment: PaymentRow; entry: KhataEntryRow; balance_paisa: number }> {
  const device = await shopDevice();
  const built = buildKhataReceipt(
    {
      shopId: device.shop_id,
      deviceId: device.id,
      staffId: staff.id,
      now: new Date(),
      customerId: customer.id,
      methodCode,
      reference,
    },
    amountPaisa,
  );
  if ('error' in built) throw new KhataNotSaved(built.error);
  await db.transaction('rw', [db.payments, db.khata_entries, db.outbox], () =>
    localWriteMany(
      [
        { table: 'payments', op: 'insert', row: { ...built.payment } },
        { table: 'khata_entries', op: 'insert', row: { ...built.entry } },
      ],
      db,
      { actorStaffId: staff.id },
    ),
  );
  return { ...built, balance_paisa: await customerBalance(customer.id) };
}

/** "Adjust balance" (owner only, note required). */
export async function adjustKhata(
  customer: CustomerRow,
  amountPaisa: number,
  note: string,
  owner: StaffRow,
): Promise<KhataEntryRow> {
  const device = await shopDevice();
  const built = buildKhataAdjustment(
    {
      shopId: device.shop_id,
      deviceId: device.id,
      staffId: owner.id,
      now: new Date(),
      customerId: customer.id,
      role: owner.role,
    },
    amountPaisa,
    note,
  );
  if ('error' in built) throw new KhataNotSaved(built.error);
  await localWriteMany([{ table: 'khata_entries', op: 'insert', row: { ...built } }], db, {
    actorStaffId: owner.id,
  });
  return built;
}
