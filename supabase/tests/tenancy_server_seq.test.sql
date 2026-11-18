-- server_seq: set from one global sequence on every insert and update (pull cursor, §4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create table tests.seen (label text primary key, seq bigint not null);
grant select, insert on tests.seen to authenticated;

insert into auth.users (id, email, aud, role) values
  ('77777777-7777-7777-7777-777777777777', 'seq-owner@test.local', 'authenticated', 'authenticated');

-- a client-supplied server_seq is ignored
insert into public.shops (id, name, type, server_seq)
  values ('abababab-0000-0000-0000-000000000001', 'Seq shop', 'general', 999999999999);
insert into tests.seen select 'shop_insert', server_seq from public.shops where id = 'abababab-0000-0000-0000-000000000001';
select isnt((select seq from tests.seen where label = 'shop_insert'), 999999999999::bigint,
  'client-supplied server_seq is overwritten');

insert into public.memberships (shop_id, user_id, role)
  values ('abababab-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'owner');
insert into tests.seen select 'membership_insert', server_seq from public.memberships
  where shop_id = 'abababab-0000-0000-0000-000000000001';
select cmp_ok((select seq from tests.seen where label = 'membership_insert'), '>',
  (select seq from tests.seen where label = 'shop_insert'), 'a later insert in another table gets a higher server_seq');

update public.shops set name = 'Seq shop 2' where id = 'abababab-0000-0000-0000-000000000001';
select cmp_ok((select server_seq from public.shops where id = 'abababab-0000-0000-0000-000000000001'), '>',
  (select seq from tests.seen where label = 'membership_insert'), 'update raises shops.server_seq');

-- as the owner, through RLS (the trigger must work without sequence privileges)
select tests.login('77777777-7777-7777-7777-777777777777');
insert into public.staff (id, shop_id, name, role)
  values ('abababab-0000-0000-0001-000000000001', 'abababab-0000-0000-0000-000000000001', 'Seq staff', 'cashier');
insert into tests.seen select 'staff_insert', server_seq from public.staff where id = 'abababab-0000-0000-0001-000000000001';
select ok((select seq from tests.seen where label = 'staff_insert') is not null, 'staff insert by owner gets a server_seq');

update public.staff set active = false where id = 'abababab-0000-0000-0001-000000000001';
select cmp_ok((select server_seq from public.staff where id = 'abababab-0000-0000-0001-000000000001'), '>',
  (select seq from tests.seen where label = 'staff_insert'), 'staff update by owner raises server_seq');

insert into public.devices (id, shop_id, name, code, registered_by)
  values ('abababab-0000-0000-0002-000000000001', 'abababab-0000-0000-0000-000000000001', 'Counter', 'A1',
          '77777777-7777-7777-7777-777777777777');
insert into tests.seen select 'device_insert', server_seq from public.devices where id = 'abababab-0000-0000-0002-000000000001';
update public.devices set last_sync_at = now() where id = 'abababab-0000-0000-0002-000000000001';
select cmp_ok((select server_seq from public.devices where id = 'abababab-0000-0000-0002-000000000001'), '>',
  (select seq from tests.seen where label = 'device_insert'), 'devices update raises server_seq');

insert into public.staff_salaries (staff_id, shop_id, monthly_salary_paisa)
  values ('abababab-0000-0000-0001-000000000001', 'abababab-0000-0000-0000-000000000001', 3000000);
insert into tests.seen select 'salary_insert', server_seq from public.staff_salaries
  where staff_id = 'abababab-0000-0000-0001-000000000001';
update public.staff_salaries set monthly_salary_paisa = 3200000 where staff_id = 'abababab-0000-0000-0001-000000000001';
select cmp_ok((select server_seq from public.staff_salaries where staff_id = 'abababab-0000-0000-0001-000000000001'), '>',
  (select seq from tests.seen where label = 'salary_insert'), 'staff_salaries update raises server_seq');

select throws_ok($$select nextval('public.server_seq')$$, '42501', null,
  'clients cannot draw from the server_seq sequence directly');

reset role;
select has_trigger('public', 'memberships', 'set_server_seq', 'memberships has the server_seq trigger');

select * from finish();
rollback;
