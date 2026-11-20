import { beforeEach, describe, expect, it } from 'vitest';
import { writeCurrentStaffId } from '../staff/currentStaff.ts';
import { DEVICE_ID, resetDb, seedReady, STAFF_ID, staffRow } from '../test/fixtures.ts';
import { NoCurrentStaffError, stampActor } from './actor.ts';
import { localWrite } from './outbox.ts';
import { db } from './schema.ts';

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';

beforeEach(async () => {
  await resetDb();
});

describe('stampActor (hook for ledger rows)', () => {
  it('adds the current staff member and this device', async () => {
    await seedReady();
    await writeCurrentStaffId(CASHIER);
    await expect(stampActor({ id: 'sale-1', total_paisa: 500 })).resolves.toEqual({
      id: 'sale-1',
      total_paisa: 500,
      staff_id: CASHIER,
      device_id: DEVICE_ID,
    });
  });

  it('falls back to the staff member who set the device up', async () => {
    await seedReady();
    expect((await stampActor({ id: 'x' })).staff_id).toBe(STAFF_ID);
  });

  it('refuses when nobody is switched in', async () => {
    await expect(stampActor({ id: 'x' })).rejects.toBeInstanceOf(NoCurrentStaffError);
  });
});

describe('outbox entries record who acted', () => {
  it('uses the current staff member unless an acting owner is given', async () => {
    await seedReady();
    await writeCurrentStaffId(CASHIER);
    const row = { ...staffRow({ id: '019a9b8e-0000-7000-8000-0000000000e9' }) };
    const asCurrent = await localWrite({ table: 'staff', op: 'upsert', row });
    const asOwner = await localWrite({ table: 'staff', op: 'upsert', row }, db, {
      actorStaffId: STAFF_ID,
    });
    expect((await db.outbox.get(asCurrent))?.actor_staff_id).toBe(CASHIER);
    expect((await db.outbox.get(asOwner))?.actor_staff_id).toBe(STAFF_ID);
  });
});
