import type { StaffRow } from '@naqdpos/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { staffRow } from '../test/fixtures.ts';
import { localWrite, localWriteMany, onLocalWrite } from './outbox.ts';
import { NaqdDb } from './schema.ts';

const opened: NaqdDb[] = [];
function freshDb(): NaqdDb {
  const database = new NaqdDb(`naqdpos-outbox-${opened.length}-${Date.now()}`);
  opened.push(database);
  return database;
}
afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close();
    await database.delete();
  }
});

const newStaff = (id: string): StaffRow =>
  staffRow({ id, role: 'cashier', name: `Staff ${id.slice(-2)}`, server_seq: 99 });

describe('local writes (row + outbox entry in one transaction)', () => {
  it('stores the row and an outbox entry, and tells listeners', async () => {
    const db = freshDb();
    const listener = vi.fn();
    const off = onLocalWrite(listener);
    const id = '019a9b8e-0000-7000-8000-0000000000e1';
    const entryId = await localWrite(
      { table: 'staff', op: 'upsert', row: { ...newStaff(id) } },
      db,
    );
    off();

    expect(await db.staff.get(id)).toMatchObject({ id, name: 'Staff e1' });
    const entry = await db.outbox.get(entryId);
    expect(entry).toMatchObject({
      table: 'staff',
      op: 'upsert',
      row_key: `staff:${id}`,
      attempts: 0,
      row: { id, name: 'Staff e1' },
    });
    // server_seq is the server's to assign; the row keeps what it was given until pulled.
    expect(entry?.created_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('writes nothing at all when one write in the batch fails', async () => {
    const db = freshDb();
    const good = newStaff('019a9b8e-0000-7000-8000-0000000000e2');
    const bad = { ...newStaff('x'), id: '' }; // no primary key
    await expect(
      localWriteMany(
        [
          { table: 'staff', op: 'upsert', row: { ...good } },
          { table: 'staff', op: 'upsert', row: bad },
        ],
        db,
      ),
    ).rejects.toThrow();
    expect(await db.staff.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('rolls back with the caller’s transaction', async () => {
    const db = freshDb();
    const row = newStaff('019a9b8e-0000-7000-8000-0000000000e3');
    await expect(
      db.transaction('rw', [db.staff, db.outbox], async () => {
        // Callers with their own transaction pass the actor (meta is not in their scope).
        await localWrite({ table: 'staff', op: 'upsert', row: { ...row } }, db, {
          actorStaffId: null,
        });
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await db.staff.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('refuses pull-only tables', async () => {
    const db = freshDb();
    await expect(
      localWrite({ table: 'devices', op: 'upsert', row: { id: 'd' } }, db),
    ).rejects.toThrow(/pull-only/);
    expect(await db.outbox.count()).toBe(0);
  });

  it('keys salary rows by staff_id', async () => {
    const db = freshDb();
    const entryId = await localWrite(
      {
        table: 'staff_salaries',
        op: 'upsert',
        row: { staff_id: 's1', shop_id: 'shop', monthly_salary_paisa: 100 },
      },
      db,
    );
    expect((await db.outbox.get(entryId))?.row_key).toBe('staff_salaries:s1');
    expect(await db.staff_salaries.get('s1')).toMatchObject({ server_seq: null });
  });
});
