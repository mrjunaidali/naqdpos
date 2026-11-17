import { afterEach, describe, expect, it } from 'vitest';
import { NaqdDb } from './schema.ts';

describe('NaqdDb schema', () => {
  let db: NaqdDb | undefined;

  afterEach(async () => {
    if (db) {
      db.close();
      await db.delete();
    }
  });

  it('is version 1 with only the meta table', async () => {
    db = new NaqdDb('naqdpos-test-schema');
    await db.open();
    expect(db.verno).toBe(1);
    expect(db.tables.map((table) => table.name)).toEqual(['meta']);
  });

  it('stores and reads meta values by key', async () => {
    db = new NaqdDb('naqdpos-test-meta');
    await db.meta.put({ key: 'storage_persisted', value: true });
    expect(await db.meta.get('storage_persisted')).toEqual({
      key: 'storage_persisted',
      value: true,
    });
  });
});
