// Backup and restore end to end (US008; run by `pnpm db:test`): pg_dump of naqdpos_test → encrypted
// → an in-memory bucket → retention → restore into a scratch database with the same row counts.
// Needs pg_dump / pg_restore (17+) on PATH or in PG_BIN_DIR.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESTORE_CHECK_TABLES, restoreBackup, runBackup } from './backup/job.ts';
import { createLogger } from './logger.ts';
import { memoryStore } from './testing/memoryStore.ts';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const SCRATCH = 'naqdpos_restore_test';
const urlFor = (database: string) => {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  url.pathname = `/${database}`;
  return url.toString();
};
const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
const key = randomBytes(32);

async function admin<T>(sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: urlFor('postgres') });
  await client.connect();
  try {
    return (await client.query(sql)).rows as T[];
  } finally {
    await client.end();
  }
}
async function counts(database: string) {
  const client = new pg.Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    const out: Record<string, number> = {};
    for (const t of RESTORE_CHECK_TABLES)
      out[t] = Number(
        (await client.query<{ n: string }>(`select count(*) n from public.${t}`)).rows[0]!.n,
      );
    return out;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await admin(`drop database if exists ${SCRATCH}`);
  await admin(`create database ${SCRATCH}`);
});
afterAll(async () => {
  await admin(`drop database if exists ${SCRATCH} with (force)`);
});

describe('nightly backup and restore (US008)', () => {
  it('dumps, encrypts, uploads (daily + monthly on the 1st), applies retention, restores', async () => {
    const store = memoryStore();
    // 31 older daily backups and 13 monthly: after tonight, 30 + 12 remain.
    for (let d = 1; d <= 31; d++)
      store.objects.set(`backups/daily/2026-10-${String(d).padStart(2, '0')}.dump.enc`, {
        body: Buffer.from('old'),
        lastModified: new Date(),
      });
    for (let m = 1; m <= 12; m++)
      store.objects.set(`backups/monthly/2025-${String(m).padStart(2, '0')}.dump.enc`, {
        body: Buffer.from('old'),
        lastModified: new Date(),
      });

    // 1 Dec 2026, 02:00 in Karachi.
    const result = await runBackup({
      adminUrl: urlFor('naqdpos_test'),
      store,
      encryptionKey: key,
      logger,
      now: new Date('2026-11-30T21:00:00Z'),
    });
    expect(result.keys).toEqual([
      'backups/daily/2026-12-01.dump.enc',
      'backups/monthly/2026-12.dump.enc',
    ]);
    const daily = [...store.objects.keys()].filter((k) => k.startsWith('backups/daily/'));
    const monthly = [...store.objects.keys()].filter((k) => k.startsWith('backups/monthly/'));
    expect(daily).toHaveLength(30);
    expect(monthly).toHaveLength(12);
    expect(store.objects.has('backups/daily/2026-10-01.dump.enc')).toBe(false);
    expect(store.objects.has('backups/daily/2026-10-02.dump.enc')).toBe(false);
    expect(store.objects.has('backups/monthly/2025-01.dump.enc')).toBe(false);

    const file = store.objects.get(result.keys[0]!)!.body;
    expect(file.subarray(0, 5).toString()).toBe('NQBK1');
    // pg_dump's custom format starts with "PGDMP": encrypted, it must not show.
    expect(file.includes(Buffer.from('PGDMP'))).toBe(false);

    const restored = await restoreBackup({
      key: result.keys[0]!,
      targetUrl: urlFor(SCRATCH),
      store,
      encryptionKey: key,
      logger,
    });
    expect(restored).toEqual(await counts('naqdpos_test'));
    expect(restored.shops).toBeGreaterThan(0);

    // Into a database that already has tables: refused before anything is downloaded.
    await expect(
      restoreBackup({
        key: result.keys[0]!,
        targetUrl: urlFor(SCRATCH),
        store,
        encryptionKey: key,
        logger,
      }),
    ).rejects.toThrow(/not empty/);
  });

  it('a wrong key never reaches pg_restore', async () => {
    const store = memoryStore();
    const { keys } = await runBackup({
      adminUrl: urlFor('naqdpos_test'),
      store,
      encryptionKey: key,
      logger,
    });
    await admin(`drop database if exists ${SCRATCH}`);
    await admin(`create database ${SCRATCH}`);
    await expect(
      restoreBackup({
        key: keys[0]!,
        targetUrl: urlFor(SCRATCH),
        store,
        encryptionKey: randomBytes(32),
        logger,
      }),
    ).rejects.toThrow(/wrong key or changed file/);
    // The scratch database is still empty.
    const client = new pg.Client({ connectionString: urlFor(SCRATCH) });
    await client.connect();
    const { rows } = await client.query<{ n: string }>(
      "select count(*) n from pg_tables where schemaname = 'public'",
    );
    await client.end();
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
