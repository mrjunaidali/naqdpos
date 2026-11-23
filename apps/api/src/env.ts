// Every setting comes from environment variables (CLAUDE.md, Portability 1; deployment §2).
// Validated once at startup so a missing value fails fast instead of on the first request; the
// error lists every missing or invalid setting by name and never echoes a value.
import { isAppVersion } from '@naqdpos/core';
import { z } from 'zod';

// .env.example lists every variable with an empty value, so empty means "not set" (loadEnv).
const optional = z.string().optional();
const required = z.string().min(1);
const origins = required.transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const common = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Files (architecture §9): all five or none. None = file features are off (local dev).
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,

  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: optional,
};

const ApiSchema = z.object({
  ...common,
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.url(),

  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  APP_ORIGINS: origins,
  /** The shop app's address, put in the owner invite email (US012). */
  POS_URL: z.url().optional(),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  // Raised only for a breaking sync change: older apps then get 426 on /sync/* (architecture §4).
  MIN_APP_VERSION: z
    .string()
    .refine(isAppVersion, 'must be major.minor.patch, e.g. 1.4.0')
    .optional(),
});

const WorkerSchema = z.object({
  ...common,
  // Owner role: pg-boss's own schema and the backup dump (architecture §9).
  DATABASE_ADMIN_URL: z.url(),
  // Backups go to their own bucket with their own token (scoped to that bucket only).
  BACKUP_S3_ENDPOINT: z.url(),
  BACKUP_S3_REGION: required,
  BACKUP_S3_BUCKET: required,
  BACKUP_S3_ACCESS_KEY_ID: required,
  BACKUP_S3_SECRET_ACCESS_KEY: required,
  /** 32 random bytes, base64 (`openssl rand -base64 32`). */
  BACKUP_ENCRYPTION_KEY: required.refine(
    (v) => Buffer.from(v, 'base64').length === 32,
    'must be 32 bytes in base64 (openssl rand -base64 32)',
  ),
});

export type Env = z.infer<typeof ApiSchema>;
export type WorkerEnv = z.infer<typeof WorkerSchema>;

const S3_KEYS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;
const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;

type Source = Record<string, string | undefined>;

/** Rules the schema can't express: all-or-nothing groups and what production needs. */
function extraProblems(kind: 'api' | 'worker', env: Source): string[] {
  const problems: string[] = [];
  const set = (key: string) => env[key] !== undefined;
  const partial = (keys: readonly string[]) =>
    keys.some(set) && !keys.every(set) ? keys.filter((k) => !set(k)) : [];
  for (const key of partial(S3_KEYS)) problems.push(`${key}: required when any S3_* is set`);
  for (const key of partial(SMTP_KEYS)) problems.push(`${key}: required when any SMTP_* is set`);

  const production = (env.NODE_ENV ?? 'production') === 'production';
  if (!production || kind === 'worker') return problems;
  // Production sends real sign-in codes: without SMTP nobody could sign in (§5).
  if (!SMTP_KEYS.some(set))
    for (const key of SMTP_KEYS) problems.push(`${key}: required in production`);
  if (!set('POS_URL')) problems.push('POS_URL: required in production');
  const https = (value: string | undefined) => !value || value.startsWith('https://');
  if (!https(env.BETTER_AUTH_URL)) problems.push('BETTER_AUTH_URL: must be https in production');
  if (!https(env.POS_URL)) problems.push('POS_URL: must be https in production');
  for (const origin of (env.APP_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean))
    if (!https(origin)) problems.push('APP_ORIGINS: every origin must be https in production');
  return [...new Set(problems)];
}

function parse<S extends z.ZodType>(schema: S, kind: 'api' | 'worker', source: Source): z.infer<S> {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== '' && v !== undefined),
  );
  const result = schema.safeParse(cleaned);
  const problems = [
    ...(result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)),
    ...extraProblems(kind, cleaned),
  ];
  if (problems.length === 0 && result.success) return result.data;
  throw new Error(`Invalid ${kind} settings:\n  ${problems.join('\n  ')}`);
}

/** API settings. Throws one error listing every missing or invalid setting by name. */
export function loadEnv(source: Source = process.env): Env {
  return parse(ApiSchema, 'api', source);
}

/** Worker settings (backups). Same rules for the shared S3 / SMTP groups. */
export function loadWorkerEnv(source: Source = process.env): WorkerEnv {
  return parse(WorkerSchema, 'worker', source);
}

/** S3 settings when files are configured, else null (file features off). */
export function s3Settings(env: Pick<Env, (typeof S3_KEYS)[number]>) {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  return S3_ENDPOINT && S3_REGION && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
    ? {
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        bucket: S3_BUCKET,
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      }
    : null;
}

/** SMTP settings when configured, else null. */
export function smtpSettings(env: Pick<Env, (typeof SMTP_KEYS)[number]>) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = env;
  return SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && MAIL_FROM
    ? { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS, from: MAIL_FROM }
    : null;
}
