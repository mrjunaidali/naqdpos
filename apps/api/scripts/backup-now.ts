// `pnpm backup:now` (docs/runbook.md §3.1): asks the running worker for one backup now, instead of
// waiting for 02:00. It only queues a job with pg-boss's own `send` on the environment's database
// (DATABASE_ADMIN_URL, the Postgres public URL from a PC); the worker on the host does the dump
// and upload, so its log shows `backup uploaded` exactly as at night. Nothing else is started here:
// no maintenance, no cron, no schema changes.
import { PgBoss } from 'pg-boss';

const QUEUE = 'nightly-backup'; // the worker's queue (src/worker.ts)

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('backup:now: DATABASE_ADMIN_URL is not set (the Postgres public URL)');
  process.exit(1);
}
// Host and database only, so a wrong target is easy to spot; never the credentials.
const { hostname, port, pathname } = new URL(url);
console.log(`backup:now: database ${hostname}:${port || 5432}${pathname}`);

const boss = new PgBoss({
  connectionString: url,
  supervise: false,
  schedule: false,
  migrate: false,
  createSchema: false,
});
boss.on('error', (error) => console.error(`backup:now: pg-boss error: ${error.message}`));

try {
  await boss.start();
  if (!(await boss.getQueue(QUEUE))) {
    console.error(
      `backup:now: no queue "${QUEUE}" in this database. Has the worker started here once?`,
    );
    process.exitCode = 1;
  } else {
    const id = await boss.send(QUEUE, null);
    // The queue's `singleton` policy runs one backup at a time; a second call queues another that
    // runs right after and overwrites the same day's file. Run it once.
    console.log(
      id
        ? `backup:now: queued job ${id}. Watch the worker log for "backup uploaded".`
        : 'backup:now: pg-boss did not queue a job; check the worker log.',
    );
  }
} catch (error) {
  console.error(`backup:now failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await boss.stop({ graceful: false, timeout: 5_000 }).catch(() => undefined);
}
