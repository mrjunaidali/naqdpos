import { describe, expect, it } from 'vitest';
import { loadEnv, loadWorkerEnv, s3Settings, smtpSettings } from './env.ts';

/** A complete production API setup. */
const production = {
  DATABASE_URL: 'postgres://naqdpos_app:secret-password@db.internal:5432/railway',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://api.naqd.pk',
  APP_ORIGINS: 'https://pos.naqd.pk, https://admin.naqd.pk',
  POS_URL: 'https://pos.naqd.pk',
  SMTP_HOST: 'smtp.resend.com',
  SMTP_PORT: '587',
  SMTP_USER: 'resend',
  SMTP_PASS: 'smtp-secret',
  MAIL_FROM: 'NaqdPOS <no-reply@naqd.pk>',
};
/** Local development without SMTP or storage. */
const development = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://naqdpos_app:secret-password@localhost:5432/naqdpos_dev',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8787',
  APP_ORIGINS: 'http://localhost:5173, http://localhost:5174',
};
const worker = {
  DATABASE_ADMIN_URL: 'postgres://postgres:owner-password@db.internal:5432/railway',
  BACKUP_S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
  BACKUP_S3_REGION: 'auto',
  BACKUP_S3_BUCKET: 'naqdpos-backups-prod',
  BACKUP_S3_ACCESS_KEY_ID: 'id',
  BACKUP_S3_SECRET_ACCESS_KEY: 'backup-secret',
  BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

const problems = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String(error);
  }
  throw new Error('expected the settings to be refused');
};

describe('API settings', () => {
  it('applies defaults and splits APP_ORIGINS', () => {
    const env = loadEnv(production);
    expect(env.PORT).toBe(8787);
    expect(env.NODE_ENV).toBe('production');
    expect(env.APP_ORIGINS).toEqual(['https://pos.naqd.pk', 'https://admin.naqd.pk']);
    expect(smtpSettings(env)).toMatchObject({ host: 'smtp.resend.com', port: 587 });
    expect(s3Settings(env)).toBeNull();
  });

  it('treats empty optional values as not set', () => {
    const env = loadEnv({ ...development, GOOGLE_CLIENT_ID: '', SMTP_HOST: '' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
  });

  it('production: lists every missing setting by name in one error', () => {
    const text = problems(() =>
      loadEnv({ DATABASE_URL: production.DATABASE_URL, BETTER_AUTH_SECRET: 'short' }),
    );
    for (const name of [
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'APP_ORIGINS',
      'POS_URL',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'MAIL_FROM',
    ])
      expect(text).toContain(name);
    expect(text).not.toContain('DATABASE_URL');
  });

  it('production needs https for the API, the app and every origin', () => {
    const text = problems(() =>
      loadEnv({
        ...production,
        BETTER_AUTH_URL: 'http://api.naqd.pk',
        APP_ORIGINS: 'https://pos.naqd.pk,http://admin.naqd.pk',
      }),
    );
    expect(text).toContain('BETTER_AUTH_URL: must be https');
    expect(text).toContain('APP_ORIGINS: every origin must be https');
  });

  it('development runs without SMTP, storage or POS_URL', () => {
    const env = loadEnv(development);
    expect(smtpSettings(env)).toBeNull();
    expect(s3Settings(env)).toBeNull();
  });

  it('S3 and SMTP are all-or-nothing', () => {
    const text = problems(() =>
      loadEnv({ ...development, S3_BUCKET: 'naqdpos-files', SMTP_HOST: 'smtp.resend.com' }),
    );
    expect(text).toContain('S3_ENDPOINT: required when any S3_* is set');
    expect(text).toContain('S3_SECRET_ACCESS_KEY: required when any S3_* is set');
    expect(text).toContain('MAIL_FROM: required when any SMTP_* is set');
    const env = loadEnv({
      ...development,
      S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
      S3_REGION: 'auto',
      S3_BUCKET: 'naqdpos-files',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(s3Settings(env)?.bucket).toBe('naqdpos-files');
  });

  it('never echoes a value in the error', () => {
    const text = problems(() =>
      loadEnv({
        ...production,
        BETTER_AUTH_SECRET: 'tiny-secret',
        PORT: 'secret-port',
        SMTP_PASS: '',
      }),
    );
    expect(text).not.toContain('tiny-secret');
    expect(text).not.toContain('secret-port');
    expect(text).not.toContain('secret-password');
  });

  it('accepts an optional MIN_APP_VERSION in major.minor.patch form', () => {
    expect(loadEnv(production).MIN_APP_VERSION).toBeUndefined();
    expect(loadEnv({ ...production, MIN_APP_VERSION: '' }).MIN_APP_VERSION).toBeUndefined();
    expect(loadEnv({ ...production, MIN_APP_VERSION: '1.4.0' }).MIN_APP_VERSION).toBe('1.4.0');
    expect(() => loadEnv({ ...production, MIN_APP_VERSION: '1.4' })).toThrow(/MIN_APP_VERSION/);
  });
});

describe('worker settings', () => {
  it('needs the admin connection, the backup bucket and its own token, and the key', () => {
    expect(loadWorkerEnv(worker).BACKUP_S3_BUCKET).toBe('naqdpos-backups-prod');
    const text = problems(() => loadWorkerEnv({}));
    for (const name of [
      'DATABASE_ADMIN_URL',
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_REGION',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
      'BACKUP_ENCRYPTION_KEY',
    ])
      expect(text).toContain(name);
    // The worker doesn't send email, so it doesn't need SMTP.
    expect(text).not.toContain('SMTP_HOST');
  });

  it('refuses an encryption key that is not 32 bytes', () => {
    const text = problems(() =>
      loadWorkerEnv({ ...worker, BACKUP_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    );
    expect(text).toContain('BACKUP_ENCRYPTION_KEY: must be 32 bytes');
  });
});
