import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';

describe('logs never contain secrets (deployment §5)', () => {
  it('redacts tokens, PINs, codes, passwords and URLs at the top and one level down', () => {
    const lines: string[] = [];
    const logger = createLogger(
      { NODE_ENV: 'production', LOG_LEVEL: 'info' },
      { write: (line: string) => void lines.push(line) },
    );
    logger.info(
      {
        otp: '123456',
        code: '654321',
        token: 'bearer-abc',
        url: 'postgres://postgres:owner-pw@db:5432/x',
        body: { pin_hash: 'pbkdf2$hash', password: 'pw', token: 'nested-token', shop_id: 'shop-1' },
        req: { headers: { authorization: 'Bearer secret-token', cookie: 'a=b' } },
      },
      'request',
    );
    const out = lines.join('\n');
    for (const secret of [
      '123456',
      '654321',
      'bearer-abc',
      'owner-pw',
      'pbkdf2$hash',
      'nested-token',
      'secret-token',
      'a=b',
    ])
      expect(out).not.toContain(secret);
    expect(out).toContain('shop-1');
  });

  it('keeps a Postgres error code for debugging', () => {
    const lines: string[] = [];
    const logger = createLogger(
      { NODE_ENV: 'production', LOG_LEVEL: 'info' },
      { write: (line: string) => void lines.push(line) },
    );
    const err = Object.assign(new Error('duplicate key'), { code: '23505' });
    logger.error({ err }, 'failed');
    expect(lines.join('\n')).toContain('23505');
  });
});
