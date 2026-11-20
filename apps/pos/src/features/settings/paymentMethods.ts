// Payment methods (US035): owners enable, disable, add (custom) and reorder; cash is always on.
// Writes go through the outbox with the acting owner (write_roles {owner}).
import { BUILT_IN_METHODS, uuidv7, type PaymentMethodRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TFunction } from 'i18next';
import { localWriteMany } from '../../db/outbox.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';

export async function shopPaymentMethods(): Promise<PaymentMethodRow[]> {
  const device = await getStoredDevice();
  if (!device) return [];
  const rows = await db.payment_methods.where('shop_id').equals(device.shop_id).toArray();
  return rows
    .filter((m) => m.deleted_at === null)
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}

export function usePaymentMethods(): PaymentMethodRow[] | undefined {
  return useLiveQuery(shopPaymentMethods);
}

/** Built-in methods are named in the UI language; custom ones by their label. */
export function methodName(method: Pick<PaymentMethodRow, 'code' | 'label'>, t: TFunction): string {
  return (BUILT_IN_METHODS as readonly string[]).includes(method.code)
    ? t(`payment.method.${method.code}`)
    : method.label;
}

const save = (rows: PaymentMethodRow[], actor: string) =>
  localWriteMany(
    rows.map((row) => ({
      table: 'payment_methods' as const,
      op: 'upsert' as const,
      row: { ...row },
    })),
    db,
    { actorStaffId: actor },
  );

export async function setMethodActive(method: PaymentMethodRow, active: boolean, actor: string) {
  if (method.code === 'cash' && !active) throw new Error('Cash cannot be switched off');
  await save([{ ...method, active, updated_at: new Date().toISOString() }], actor);
}

export async function moveMethod(id: string, direction: -1 | 1, actor: string) {
  const list = await shopPaymentMethods();
  const from = list.findIndex((m) => m.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return;
  const reordered = [...list];
  [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
  const now = new Date().toISOString();
  const changed = reordered.flatMap((m, i) =>
    m.sort === i + 1 ? [] : [{ ...m, sort: i + 1, updated_at: now }],
  );
  if (changed.length) await save(changed, actor);
}

/** A custom method: code custom_<8 hex>, made on the device. */
export async function addCustomMethod(label: string, actor: string): Promise<PaymentMethodRow> {
  const device = await getStoredDevice();
  if (!device) throw new Error('This device is not set up');
  const list = await shopPaymentMethods();
  const now = new Date().toISOString();
  const id = uuidv7();
  const row: PaymentMethodRow = {
    id,
    shop_id: device.shop_id,
    code: `custom_${id.replace(/-/g, '').slice(-8)}`,
    label: label.trim(),
    active: true,
    sort: Math.max(0, ...list.map((m) => m.sort)) + 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    device_id: device.id,
    server_seq: null,
  };
  await save([row], actor);
  return row;
}
