import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  backupKeys,
  decryptStream,
  encryptStream,
  expiredBackups,
  parseBackupKey,
  pgEnv,
} from './backup.ts';

const KEY = randomBytes(32);

async function run(input: Buffer[], ...steps: NodeJS.ReadWriteStream[]): Promise<Buffer> {
  const out: Buffer[] = [];
  await pipeline(
    Readable.from(input),
    ...(steps as [NodeJS.ReadWriteStream]),
    async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) out.push(chunk);
    },
  );
  return Buffer.concat(out);
}

/** Feeds data in uneven chunks, as a pipe from pg_dump would. */
function chunks(data: Buffer, size: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.subarray(i, i + size));
  return out;
}

describe('backup encryption (AES-256-GCM, streaming)', () => {
  it('round trip on a multi-megabyte dump in odd chunk sizes', async () => {
    const dump = randomBytes(3 * 1024 * 1024 + 17);
    const encrypted = await run(chunks(dump, 65_537), encryptStream(KEY));
    expect(encrypted.subarray(0, 5).toString()).toBe('NQBK1');
    expect(encrypted.length).toBe(dump.length + 5 + 12 + 16);
    expect(encrypted.includes(dump.subarray(0, 64))).toBe(false);
    const decrypted = await run(chunks(encrypted, 7_919), decryptStream(KEY));
    expect(decrypted.equals(dump)).toBe(true);
  });

  it('round trip on an empty input and on tiny chunks', async () => {
    expect((await run([], encryptStream(KEY), decryptStream(KEY))).length).toBe(0);
    const small = Buffer.from('pg_dump output');
    const enc = await run([small], encryptStream(KEY));
    expect((await run(chunks(enc, 1), decryptStream(KEY))).equals(small)).toBe(true);
  });

  it('each backup gets its own IV', async () => {
    const data = Buffer.from('same data');
    const a = await run([data], encryptStream(KEY));
    const b = await run([data], encryptStream(KEY));
    expect(a.equals(b)).toBe(false);
  });

  it('refuses the wrong key, a changed byte, a cut-off file and a foreign file', async () => {
    const enc = await run([randomBytes(5000)], encryptStream(KEY));
    await expect(run([enc], decryptStream(randomBytes(32)))).rejects.toThrow(
      /wrong key or changed/,
    );
    const changed = Buffer.from(enc);
    changed[2000] = changed[2000]! ^ 1;
    await expect(run([changed], decryptStream(KEY))).rejects.toThrow(/wrong key or changed/);
    await expect(run([enc.subarray(0, 20)], decryptStream(KEY))).rejects.toThrow();
    await expect(
      run([Buffer.from('PGDMP-not-encrypted-file')], decryptStream(KEY)),
    ).rejects.toThrow(/not a NaqdPOS backup/);
  });

  it('the key must be 32 bytes of base64', () => {
    expect(parseBackupKey(KEY.toString('base64')).equals(KEY)).toBe(true);
    expect(() => parseBackupKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('backup keys and retention', () => {
  it('daily key every night, plus a monthly key on the 1st', () => {
    expect(backupKeys('2026-11-23')).toEqual(['backups/daily/2026-11-23.dump.enc']);
    expect(backupKeys('2026-12-01')).toEqual([
      'backups/daily/2026-12-01.dump.enc',
      'backups/monthly/2026-12.dump.enc',
    ]);
  });

  const daily = (n: number, from = new Date(Date.UTC(2026, 0, 1))) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      return `backups/daily/${d}.dump.enc`;
    });
  const monthly = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const y = 2025 + Math.floor(i / 12);
      return `backups/monthly/${y}-${String((i % 12) + 1).padStart(2, '0')}.dump.enc`;
    });

  it('keeps the newest 30 daily and 12 monthly', () => {
    const keys = [...daily(31), ...monthly(13)];
    expect(expiredBackups(keys)).toEqual([
      'backups/daily/2026-01-01.dump.enc',
      'backups/monthly/2025-01.dump.enc',
    ]);
    expect(expiredBackups([...daily(30), ...monthly(12)])).toEqual([]);
  });

  it('counts backups, not days: gaps (a missed night) do not delete more', () => {
    const withGaps = daily(60).filter((_, i) => i % 2 === 0); // 30 backups over 60 days
    expect(expiredBackups(withGaps)).toEqual([]);
  });

  it('order of the listing does not matter; other files are never deleted', () => {
    const keys = [...daily(35)].reverse();
    keys.push('backups/manual/before-migration.dump', 'backups/daily/notes.txt');
    const expired = expiredBackups(keys);
    expect(expired).toHaveLength(5);
    expect(expired[0]).toBe('backups/daily/2026-01-01.dump.enc');
    expect(expired).not.toContain('backups/manual/before-migration.dump');
    expect(expired).not.toContain('backups/daily/notes.txt');
  });

  it('libpq settings from a URL keep the password out of the command line', () => {
    expect(
      pgEnv('postgres://postgres:p%40ss@db.railway.internal:5432/railway?sslmode=disable'),
    ).toEqual({
      PGHOST: 'db.railway.internal',
      PGPORT: '5432',
      PGUSER: 'postgres',
      PGPASSWORD: 'p@ss',
      PGDATABASE: 'railway',
      PGSSLMODE: 'disable',
    });
  });
});
