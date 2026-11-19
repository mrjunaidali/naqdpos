import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, errorCode, type Fixture } from './helpers.ts';

let f: Fixture;
// Same role and URL as the API's Better Auth pool (apps/api/src/auth.ts createAuthPool).
const authPool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 1,
  options: '-c app.context=auth',
});

beforeAll(async () => {
  f = await createFixture();
  await admin.query(
    `insert into sessions (user_id, token, expires_at) values ($1, $2, now() + interval '1 day')`,
    [f.ownerA, `token-${f.ownerA}`],
  );
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end(), authPool.end()]);
});

describe('Better Auth tables', () => {
  it('are closed to tenant queries, even for a signed-in user', async () => {
    await asUser(f.ownerA, async (q) => {
      for (const table of ['users', 'sessions', 'accounts', 'verifications', 'two_factors']) {
        expect((await q(`select 1 from ${table}`)).rowCount, table).toBe(0);
      }
      expect(
        await errorCode(
          q(
            `insert into sessions (user_id, token, expires_at) values ($1, 'x', now() + interval '1 day')`,
            [f.ownerA],
          ),
        ),
      ).toBe('42501');
    });
  });

  it('are open to the auth pool (app.context = auth)', async () => {
    const { rows } = await authPool.query<{ user_id: string }>(
      'select user_id from sessions where token = $1',
      [`token-${f.ownerA}`],
    );
    expect(rows).toEqual([{ user_id: f.ownerA }]);
  });
});
