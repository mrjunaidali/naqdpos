-- migrate:up
-- The API refuses to start when the database is behind it (bug 2026-11-26: staging ran without a
-- pre-deploy step, so 20261125090000 and 20261126090000 were never applied). naqdpos_app has no
-- access to schema_migrations (db/tests/roles.test.ts); this function shows it the applied
-- versions only, nothing else. The API compares them with the files in db/migrations.

create function public.applied_migrations()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select version::text from public.schema_migrations order by version;
$$;

revoke execute on function public.applied_migrations() from public;
grant execute on function public.applied_migrations() to naqdpos_app;

-- migrate:down
drop function public.applied_migrations();
