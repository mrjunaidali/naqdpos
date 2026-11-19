import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.ts';

const valid = {
  DATABASE_URL: 'postgres://naqdpos_app:secret-password@localhost:5432/naqdpos_dev',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8787',
  APP_ORIGINS: 'http://localhost:5173, http://localhost:5174',
};

describe('loadEnv', () => {
  it('applies defaults and splits APP_ORIGINS', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(8787);
    expect(env.NODE_ENV).toBe('production');
    expect(env.APP_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('treats empty optional values as not set', () => {
    const env = loadEnv({ ...valid, GOOGLE_CLIENT_ID: '', SMTP_HOST: '' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
  });

  it('names every missing or invalid variable', () => {
    expect(() =>
      loadEnv({ ...valid, DATABASE_URL: undefined, BETTER_AUTH_SECRET: 'short' }),
    ).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET/);
  });

  it('never echoes a value in the error', () => {
    try {
      loadEnv({ ...valid, BETTER_AUTH_SECRET: 'tiny-secret', PORT: 'secret-port' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('tiny-secret');
      expect(String(error)).not.toContain('secret-port');
    }
  });
});
