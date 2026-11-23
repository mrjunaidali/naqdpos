// Nightly backups (US008, deployment §5): key names, what to keep, and the encrypted file format.
// Pure functions and streams; the job (job.ts) and the restore CLI put them together.
import { createCipheriv, createDecipheriv, randomBytes, type DecipherGCM } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

export const DAILY_PREFIX = 'backups/daily/';
export const MONTHLY_PREFIX = 'backups/monthly/';
export const KEEP_DAILY = 30;
export const KEEP_MONTHLY = 12;

const DAILY = /^backups\/daily\/(\d{4}-\d{2}-\d{2})\.dump\.enc$/;
const MONTHLY = /^backups\/monthly\/(\d{4}-\d{2})\.dump\.enc$/;

/** The keys one night's backup is stored under (the 1st of a month also gets a monthly copy). */
export function backupKeys(businessDate: string): string[] {
  const keys = [`${DAILY_PREFIX}${businessDate}.dump.enc`];
  if (businessDate.endsWith('-01'))
    keys.push(`${MONTHLY_PREFIX}${businessDate.slice(0, 7)}.dump.enc`);
  return keys;
}

/**
 * Keys to delete so that the newest 30 daily and newest 12 monthly backups remain. Anything that
 * doesn't look like one of our backup keys is never deleted.
 */
export function expiredBackups(
  keys: readonly string[],
  keepDaily = KEEP_DAILY,
  keepMonthly = KEEP_MONTHLY,
): string[] {
  const older = (pattern: RegExp, keep: number) =>
    keys
      .filter((k) => pattern.test(k))
      .sort() // dates in the name sort in time order
      .reverse()
      .slice(keep);
  return [...older(DAILY, keepDaily), ...older(MONTHLY, keepMonthly)].sort();
}

// --- Encrypted file: "NQBK1" | 12-byte IV | AES-256-GCM ciphertext | 16-byte tag ---

const MAGIC = Buffer.from('NQBK1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseBackupKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes in base64');
  return key;
}

/** Encrypts a stream; the tag goes at the end, so it works on a dump of any size. */
export function encryptStream(key: Buffer): Transform {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      if (!started) {
        this.push(Buffer.concat([MAGIC, iv]));
        started = true;
      }
      done(null, cipher.update(chunk));
    },
    flush(done: TransformCallback) {
      if (!started) this.push(Buffer.concat([MAGIC, iv]));
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
}

/**
 * Decrypts a stream. GCM only proves the data is genuine at the very end (wrong key, changed or
 * cut-off file → error on flush), so callers must write to a temporary file and use it only
 * after the stream finished without an error.
 */
export function decryptStream(key: Buffer): Transform {
  let header = Buffer.alloc(0);
  let decipher: DecipherGCM | null = null;
  // The last 16 bytes are the tag: always hold them back until the end.
  let tail = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      try {
        let data = chunk;
        if (!decipher) {
          header = Buffer.concat([header, data]);
          if (header.length < MAGIC.length + IV_BYTES) return done();
          if (!header.subarray(0, MAGIC.length).equals(MAGIC))
            throw new Error('not a NaqdPOS backup file');
          const iv = header.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
          decipher = createDecipheriv('aes-256-gcm', key, iv);
          data = header.subarray(MAGIC.length + IV_BYTES);
        }
        const all = Buffer.concat([tail, data]);
        tail = all.subarray(Math.max(0, all.length - TAG_BYTES));
        done(null, decipher.update(all.subarray(0, all.length - tail.length)));
      } catch (error) {
        done(error as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        if (!decipher || tail.length !== TAG_BYTES) throw new Error('backup file is cut off');
        decipher.setAuthTag(tail);
        done(null, decipher.final());
      } catch (error) {
        done(
          error instanceof Error && /auth/i.test(error.message)
            ? new Error('backup could not be decrypted: wrong key or changed file')
            : (error as Error),
        );
      }
    },
  });
}

/** libpq settings from a connection URL, so passwords never appear in a command line. */
export function pgEnv(url: string): Record<string, string> {
  const u = new URL(url);
  const env: Record<string, string> = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}
