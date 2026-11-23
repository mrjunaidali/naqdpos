// The nightly backup job (US008) and the restore (runbook.md): pg_dump → AES-256-GCM → the backups
// bucket, and back. Uses the owner role (DATABASE_ADMIN_URL), which is what the worker's admin
// connection is for (architecture §9). Connection strings never reach logs or command lines.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { businessDate } from '@naqdpos/core';
import pg from 'pg';
import type { Logger } from '../logger.ts';
import type { ObjectStore } from '../storage.ts';
import { backupKeys, decryptStream, encryptStream, expiredBackups, pgEnv } from './backup.ts';

/** pg_dump / pg_restore from PG_BIN_DIR when set (a dev PC), else from PATH (the image). */
export function pgTool(name: 'pg_dump' | 'pg_restore'): string {
  const dir = process.env.PG_BIN_DIR;
  return dir ? join(dir, process.platform === 'win32' ? `${name}.exe` : name) : name;
}

/** Runs a Postgres tool with the connection in libpq variables; rejects with its stderr. */
function runPgTool(
  tool: 'pg_dump' | 'pg_restore',
  args: string[],
  url: string,
  stdout?: (out: Readable) => Promise<void>,
): Promise<void> {
  const child = spawn(pgTool(tool), args, {
    env: { ...process.env, ...pgEnv(url) },
    stdio: ['ignore', stdout ? 'pipe' : 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    if (stderr.length < 4000) stderr += chunk.toString();
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${tool} failed (exit ${code}): ${stderr.trim()}`)),
    );
  });
  return Promise.all([exited, stdout ? stdout(child.stdout!) : Promise.resolve()]).then(
    () => undefined,
  );
}

const tempFile = (suffix: string) => join(tmpdir(), `naqdpos-${randomUUID()}${suffix}`);

export interface BackupResult {
  keys: string[];
  deleted: string[];
}

export async function runBackup(options: {
  adminUrl: string;
  store: ObjectStore;
  encryptionKey: Buffer;
  logger: Logger;
  now?: Date;
}): Promise<BackupResult> {
  const { store, logger } = options;
  const date = businessDate(options.now ?? new Date());
  const file = tempFile('.dump.enc');
  try {
    // Custom format: compressed, and pg_restore can pick tables from it.
    await runPgTool('pg_dump', ['--format=custom', '--no-password'], options.adminUrl, (out) =>
      pipeline(out, encryptStream(options.encryptionKey), createWriteStream(file)),
    );
    const keys = backupKeys(date);
    for (const key of keys) await store.putFile(key, file);
    logger.info({ keys }, 'backup uploaded');

    const existing = (await store.list('backups/')).map((o) => o.key);
    const deleted = expiredBackups(existing);
    if (deleted.length) {
      await store.delete(deleted);
      logger.info({ deleted }, 'old backups deleted');
    }
    return { keys, deleted };
  } finally {
    await rm(file, { force: true });
  }
}

/** Number of tables outside the system schemas: a restore only goes into an empty database. */
async function tableCount(url: string): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from pg_tables
       where schemaname not in ('pg_catalog', 'information_schema')`,
    );
    return Number(rows[0]!.n);
  } finally {
    await client.end();
  }
}

export const RESTORE_CHECK_TABLES = [
  'shops',
  'staff',
  'products',
  'sales',
  'khata_entries',
  'expenses',
];

/**
 * Downloads, decrypts and restores one backup into an EMPTY database (a scratch DB for the
 * monthly drill, or a fresh one after a disaster). The file is fully decrypted and its GCM tag
 * checked before pg_restore reads it. Returns row counts of the main tables.
 */
export async function restoreBackup(options: {
  key: string;
  targetUrl: string;
  store: ObjectStore;
  encryptionKey: Buffer;
  logger: Logger;
}): Promise<Record<string, number>> {
  if ((await tableCount(options.targetUrl)) > 0)
    throw new Error('The target database is not empty. Restore only into a new, empty database.');
  const file = tempFile('.dump');
  try {
    await pipeline(
      await options.store.get(options.key),
      decryptStream(options.encryptionKey),
      createWriteStream(file),
    );
    options.logger.info({ key: options.key }, 'backup downloaded and verified');
    // --no-owner: objects belong to whoever restores. Grants stay, so naqdpos_app must exist
    // in the target server (runbook.md). One transaction: a failure leaves the target empty.
    await runPgTool(
      'pg_restore',
      [
        '--no-owner',
        '--exit-on-error',
        '--single-transaction',
        '--no-password',
        '--dbname',
        pgEnv(options.targetUrl).PGDATABASE!,
        file,
      ],
      options.targetUrl,
    );
    const client = new pg.Client({ connectionString: options.targetUrl });
    await client.connect();
    try {
      const counts: Record<string, number> = {};
      for (const table of RESTORE_CHECK_TABLES) {
        const { rows } = await client.query<{ n: string }>(
          `select count(*) as n from public.${table}`,
        );
        counts[table] = Number(rows[0]!.n);
      }
      return counts;
    } finally {
      await client.end();
    }
  } finally {
    await rm(file, { force: true });
  }
}
