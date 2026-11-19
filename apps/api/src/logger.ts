import { pino, type Logger } from 'pino';
import type { Env } from './env.ts';

export type { Logger };

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    // pino-pretty is a dev dependency, so it is only used locally. Production logs stay JSON.
    ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  });
}
