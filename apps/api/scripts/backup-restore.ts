// `pnpm backup:restore <key> <target DATABASE_URL>` (docs/runbook.md): downloads one backup from
// the backups bucket, decrypts it and restores it into an EMPTY database, then prints row counts.
// Needs BACKUP_S3_* and BACKUP_ENCRYPTION_KEY (from .env or the shell) and pg_restore 17+ on PATH
// or in PG_BIN_DIR. `pnpm backup:restore --list` shows the stored backups.
import { parseBackupKey } from '../src/backup/backup.ts';
import { restoreBackup } from '../src/backup/job.ts';
import { createLogger } from '../src/logger.ts';
import { s3Store } from '../src/storage.ts';

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`backup:restore: ${name} is not set`);
    process.exit(1);
  }
  return value;
}

const [key, targetUrl] = process.argv.slice(2);
const store = s3Store({
  endpoint: need('BACKUP_S3_ENDPOINT'),
  region: need('BACKUP_S3_REGION'),
  bucket: need('BACKUP_S3_BUCKET'),
  accessKeyId: need('BACKUP_S3_ACCESS_KEY_ID'),
  secretAccessKey: need('BACKUP_S3_SECRET_ACCESS_KEY'),
});

if (key === '--list') {
  for (const o of await store.list('backups/'))
    console.log(`${o.key}  ${o.lastModified.toISOString()}`);
  process.exit(0);
}
if (!key || !targetUrl) {
  console.error(
    'Usage: pnpm backup:restore <key> <target DATABASE_URL>  |  pnpm backup:restore --list',
  );
  process.exit(1);
}

try {
  const counts = await restoreBackup({
    key,
    targetUrl,
    store,
    encryptionKey: parseBackupKey(need('BACKUP_ENCRYPTION_KEY')),
    logger: createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'info' }),
  });
  console.log(`Restored ${key}. Rows:`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(14)} ${n}`);
} catch (error) {
  // The message names the step; connection strings are never part of it.
  console.error(`backup:restore failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
