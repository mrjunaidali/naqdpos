// The startup check (server.ts) against naqdpos_test, run by `pnpm db:test` after all migrations.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db/index.ts';
import {
  APPLIED_MIGRATIONS_VERSION,
  migrationVersions,
  pendingMigrations,
} from './db/migrations.ts';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const appUrl = process.env.TEST_DATABASE_URL ?? '';
// The owner role on naqdpos_test, for the test that hides the function (and restores it).
const ownerUrl = new URL(process.env.DATABASE_ADMIN_URL ?? '');
ownerUrl.pathname = new URL(appUrl).pathname;

const db = createDb(appUrl); // naqdpos_app, like the API
const owner = new pg.Pool({ connectionString: ownerUrl.toString(), max: 1 });
afterAll(async () => {
  await Promise.all([db.destroy(), owner.end()]);
});

describe('pendingMigrations (API startup check)', () => {
  it('is empty on a fully migrated database, as naqdpos_app', async () => {
    expect(await pendingMigrations(db, migrationVersions())).toEqual([]);
  });

  it('names a migration the database has not applied', async () => {
    const expected = [...migrationVersions(), '29991231235959'];
    expect(await pendingMigrations(db, expected)).toEqual(['29991231235959']);
  });

  it('counts a database without applied_migrations() as behind', async () => {
    await owner.query('alter function public.applied_migrations() rename to applied_hidden');
    try {
      const pending = await pendingMigrations(db, migrationVersions());
      expect(pending[0]).toBe(APPLIED_MIGRATIONS_VERSION);
    } finally {
      await owner.query('alter function public.applied_hidden() rename to applied_migrations');
    }
  });

  it('gives naqdpos_app the versions, still not the table', async () => {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from public.applied_migrations()`.execute(db);
    expect(rows[0]!.n).toBe(migrationVersions().length);
    await expect(sql`select * from public.schema_migrations`.execute(db)).rejects.toMatchObject({
      code: '42501',
    });
  });
});
