// Every setting comes from environment variables (CLAUDE.md, Portability 1; deployment §2).
// Validated once at startup so a missing value fails fast instead of on the first request.
import { z } from 'zod';

// .env.example lists every variable with an empty value, so empty means "not set" (loadEnv).
const optional = z.string().optional();
const required = z.string().min(1);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.url(),

  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  APP_ORIGINS: required.transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  SMTP_HOST: optional,
  SMTP_PORT: optional,
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: optional,

  S3_ENDPOINT: optional,
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses settings; the error names the bad variables but never echoes their values. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment settings:\n  ${problems.join('\n  ')}`);
}
