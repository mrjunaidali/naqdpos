import { pino, type DestinationStream, type Logger } from 'pino';
import type { Env } from './env.ts';

export type { Logger };

/**
 * Never logged (deployment §5): tokens, PINs, codes, passwords and connection strings. Censored
 * at the top level and one level down (e.g. `{ body: { pin_hash } }`). `code` only at the top:
 * `err.code` (Postgres SQLSTATE) is needed to debug.
 */
const SECRET_FIELDS = [
  'otp',
  'pin',
  'pin_hash',
  'token',
  'password',
  'secret',
  'authorization',
  'cookie',
  'url',
];
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'code',
  ...SECRET_FIELDS,
  ...SECRET_FIELDS.map((field) => `*.${field}`),
];

export function createLogger(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: env.NODE_ENV === 'test' && !destination ? 'silent' : env.LOG_LEVEL,
    // pino-pretty is a dev dependency, so it is only used locally. Production logs stay JSON.
    ...(env.NODE_ENV === 'development' && !destination && { transport: { target: 'pino-pretty' } }),
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  return destination ? pino(options, destination) : pino(options);
}
