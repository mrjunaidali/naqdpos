import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, app, asUser, createFixture, errorCode, type Fixture } from './helpers.ts';

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('naqdpos_app role (CLAUDE.md rule 5)', () => {
  it('is the role the tests connect as', async () => {
    const { rows } = await app.query<{ u: string }>('select current_user as u');
    expect(rows[0]?.u).toBe('naqdpos_app');
  });

  it('is not a superuser and cannot bypass RLS', async () => {
    const { rows } = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = 'naqdpos_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('owns no tables, functions, sequences or schemas', async () => {
    const { rows } = await admin.query<{ n: number }>(
      `select (
         (select count(*) from pg_class where relowner = r.oid) +
         (select count(*) from pg_proc where proowner = r.oid) +
         (select count(*) from pg_namespace where nspowner = r.oid)
       )::int as n
       from pg_roles r where rolname = 'naqdpos_app'`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('has RLS enabled on every table in public', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
         and c.relname <> 'schema_migrations'`,
    );
    expect(rows).toEqual([]);
  });

  it('has no access to platform_admins, audit_log or the server_seq sequence', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q('select * from platform_admins'))).toBe('42501');
      expect(await errorCode(q('select * from audit_log'))).toBe('42501');
      expect(await errorCode(q(`select nextval('server_seq')`))).toBe('42501');
      expect(await errorCode(q('select * from schema_migrations'))).toBe('42501');
    });
  });

  it('cannot create objects in the public schema', async () => {
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(q('create table public.x (id int)'))).toBe('42501');
    });
  });
});
