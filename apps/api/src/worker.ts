// Worker entry (architecture §9): `pnpm --filter @naqdpos/api worker`, same image as the API.
// pg-boss keeps its queue in the same Postgres (schema pgboss).
//
// The worker connects with DATABASE_ADMIN_URL only for jobs that need the owner role (backups,
// maintenance; pg-boss also creates its own schema). Future jobs that read or write shop data
// must use naqdpos_app with the user / shop context and RLS, like the API (architecture §9).
import { PgBoss } from 'pg-boss';
import { parseBackupKey } from './backup/backup.ts';
import { runBackup } from './backup/job.ts';
import { loadWorkerEnv } from './env.ts';
import { createLogger } from './logger.ts';
import { s3Store } from './storage.ts';

const BACKUP_QUEUE = 'nightly-backup';
/** 02:00 shop time, when no shop is selling. */
const BACKUP_CRON = '0 2 * * *';

const env = loadWorkerEnv();
const logger = createLogger(env);
const backups = s3Store({
  endpoint: env.BACKUP_S3_ENDPOINT,
  region: env.BACKUP_S3_REGION,
  bucket: env.BACKUP_S3_BUCKET,
  accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
  secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
});
const encryptionKey = parseBackupKey(env.BACKUP_ENCRYPTION_KEY);

const boss = new PgBoss(env.DATABASE_ADMIN_URL);
boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));
await boss.start();

// One backup at a time; a failed night is retried twice, 10 minutes apart.
await boss.createQueue(BACKUP_QUEUE, {
  policy: 'singleton',
  retryLimit: 2,
  retryDelay: 600,
  expireInSeconds: 60 * 60,
});
// If the worker was down at 02:00 (a deploy), run the missed backup once when it is back.
await boss.schedule(BACKUP_QUEUE, BACKUP_CRON, null, { tz: 'Asia/Karachi', missed: 'once' });
await boss.work(BACKUP_QUEUE, async () => {
  try {
    await runBackup({ adminUrl: env.DATABASE_ADMIN_URL, store: backups, encryptionKey, logger });
  } catch (error) {
    // Logged here (without the connection string, see job.ts) and rethrown so pg-boss retries.
    logger.error({ err: error }, 'backup failed');
    throw error;
  }
});
logger.info(
  { queue: BACKUP_QUEUE, cron: BACKUP_CRON, tz: 'Asia/Karachi' },
  'NaqdPOS worker started',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
