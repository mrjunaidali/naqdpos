// Is the database behind this API? (bug 2026-11-26: staging had no pre-deploy step, so two
// migrations were never applied and every sync pull failed.) The API reads the migration files it
// was built with and compares them with public.applied_migrations(); server.ts refuses to start
// when any are missing, so a deploy fails its healthcheck and the old API keeps running.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import type { Db } from './index.ts';

/** db/migrations: in the image /repo/db/migrations (Dockerfile), on a dev PC the repo's folder. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../../../db/migrations');

/** The migration that adds public.applied_migrations(). */
export const APPLIED_MIGRATIONS_VERSION = '20261127090000';

/** Versions (the 14-digit prefix) of the migration files in `dir`, oldest first. */
export function migrationVersions(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .map((name) => /^(\d{14})_.+\.sql$/.exec(name)?.[1])
    .filter((v): v is string => v !== undefined)
    .sort();
}

/** Expected versions the database has not applied, oldest first. */
export function missingMigrations(expected: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return expected.filter((v) => !done.has(v));
}

/**
 * The expected migrations this database lacks. A database older than 20261127090000 has no
 * applied_migrations() (Postgres 42883), so it is behind by at least that one: the comparison then
 * reports everything from that version on. A database *ahead* of the API (rollback) is fine.
 */
export async function pendingMigrations(db: Db, expected: string[]): Promise<string[]> {
  try {
    const { rows } = await sql<{ v: string }>`select v from public.applied_migrations() v`.execute(
      db,
    );
    return missingMigrations(
      expected,
      rows.map((r) => r.v),
    );
  } catch (error) {
    if ((error as { code?: string }).code !== '42883') throw error;
    return expected.filter((v) => v >= APPLIED_MIGRATIONS_VERSION);
  }
}
