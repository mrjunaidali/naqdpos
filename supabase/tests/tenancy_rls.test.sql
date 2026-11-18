-- RLS for the tenancy tables: anon, cross-shop isolation, role limits, admin-only tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- helpers (rolled back with the test) -----------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function tests.login_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
-- rows touched by a statement, as the current role (so RLS applies)
create function tests.row_count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- fixtures (as postgres, bypassing RLS) ----------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('11111111-1111-1111-1111-111111111112', 'cashier-a@test.local', 'authenticated', 'authenticated'),
  ('11111111-1111-1111-1111-111111111113', 'rider-a@test.local', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222221', 'owner-b@test.local', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@test.local', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'admin@test.local', 'authenticated', 'authenticated');

insert into public.shops (id, name, type) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Shop A', 'fruit_veg'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Shop B', 'grocery');

insert into public.memberships (shop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111112', 'cashier'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111113', 'rider'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222221', 'owner');

insert into public.staff (id, shop_id, name, role, membership_user_id) values
  ('aaaaaaaa-0000-0000-0001-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Owner A', 'owner', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0001-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Cashier A', 'cashier', null),
  ('bbbbbbbb-0000-0000-0001-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Owner B', 'owner', '22222222-2222-2222-2222-222222222221');

insert into public.staff_salaries (staff_id, shop_id, monthly_salary_paisa) values
  ('aaaaaaaa-0000-0000-0001-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 3000000),
  ('bbbbbbbb-0000-0000-0001-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 5000000);

insert into public.devices (id, shop_id, name, code) values
  ('aaaaaaaa-0000-0000-0002-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Counter A', 'A1'),
  ('bbbbbbbb-0000-0000-0002-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Counter B', 'A1');

insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');
insert into public.audit_log (shop_id, action, entity) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test', 'shops');

-- anon: nothing --------------------------------------------------------------
select tests.login_anon();
select throws_ok('select * from public.shops', '42501', null, 'anon cannot read shops');
select throws_ok('select * from public.memberships', '42501', null, 'anon cannot read memberships');
select throws_ok('select * from public.staff', '42501', null, 'anon cannot read staff');
select throws_ok('select * from public.staff_salaries', '42501', null, 'anon cannot read staff_salaries');
select throws_ok('select * from public.devices', '42501', null, 'anon cannot read devices');
select throws_ok('select * from public.platform_admins', '42501', null, 'anon cannot read platform_admins');
select throws_ok('select * from public.audit_log', '42501', null, 'anon cannot read audit_log');
select throws_ok(
  $$insert into public.shops (id, name, type) values ('cccccccc-0000-0000-0000-000000000001', 'X', 'meat')$$,
  '42501', null, 'anon cannot insert shops');
select throws_ok('select public.is_shop_member(''aaaaaaaa-0000-0000-0000-000000000001'')',
  '42501', null, 'anon cannot call is_shop_member');

-- owner A: own shop only -----------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111111');
select set_eq('select id from public.shops', array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
  'owner A sees only shop A');
select set_eq('select distinct shop_id from public.memberships', array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
  'owner A sees only shop A memberships');
select set_eq('select distinct shop_id from public.staff', array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
  'owner A sees only shop A staff');
select set_eq('select distinct shop_id from public.devices', array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
  'owner A sees only shop A devices');
select set_eq('select staff_id from public.staff_salaries', array['aaaaaaaa-0000-0000-0001-000000000002'::uuid],
  'owner A sees only shop A salaries');

select is(tests.row_count($$update public.shops set name = 'hacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$),
  0::bigint, 'owner A cannot update shop B');
select is(tests.row_count($$update public.staff set name = 'hacked' where shop_id = 'bbbbbbbb-0000-0000-0000-000000000001'$$),
  0::bigint, 'owner A cannot update shop B staff');
select is(tests.row_count($$update public.devices set name = 'hacked' where shop_id = 'bbbbbbbb-0000-0000-0000-000000000001'$$),
  0::bigint, 'owner A cannot update shop B devices');
select is(tests.row_count($$update public.staff_salaries set monthly_salary_paisa = 1 where shop_id = 'bbbbbbbb-0000-0000-0000-000000000001'$$),
  0::bigint, 'owner A cannot update shop B salaries');
select throws_ok(
  $$insert into public.staff (id, shop_id, name, role) values ('bbbbbbbb-0000-0000-0001-000000000099', 'bbbbbbbb-0000-0000-0000-000000000001', 'Spy', 'cashier')$$,
  '42501', null, 'owner A cannot insert staff into shop B');
select throws_ok(
  $$insert into public.devices (id, shop_id, name, code, registered_by) values ('bbbbbbbb-0000-0000-0002-000000000099', 'bbbbbbbb-0000-0000-0000-000000000001', 'Spy', 'A9', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'owner A cannot insert devices into shop B');
select throws_ok(
  $$update public.staff set shop_id = 'bbbbbbbb-0000-0000-0000-000000000001' where id = 'aaaaaaaa-0000-0000-0001-000000000002'$$,
  '42501', null, 'owner A cannot move staff into shop B');
select throws_ok(
  $$insert into public.memberships (shop_id, user_id, role) values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner')$$,
  '42501', null, 'owner A cannot add a membership (even to shop B)');

select is(tests.row_count($$update public.shops set name = 'Shop A2', updated_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$),
  1::bigint, 'owner A can update shop A settings');
select throws_ok(
  $$update public.shops set status = 'suspended' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null, 'owner A cannot change shop status');
select throws_ok(
  $$update public.shops set plan_id = 'free' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null, 'owner A cannot change shop plan');
select lives_ok(
  $$insert into public.staff (id, shop_id, name, role) values ('aaaaaaaa-0000-0000-0001-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'New cashier', 'cashier')$$,
  'owner A can add staff');
select is(tests.row_count($$update public.staff set active = false where id = 'aaaaaaaa-0000-0000-0001-000000000003'$$),
  1::bigint, 'owner A can update staff');
select lives_ok(
  $$insert into public.staff_salaries (staff_id, shop_id, monthly_salary_paisa) values ('aaaaaaaa-0000-0000-0001-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 2500000)$$,
  'owner A can set a salary');
select lives_ok(
  $$insert into public.devices (id, shop_id, name, code, registered_by) values ('aaaaaaaa-0000-0000-0002-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Counter 2', 'A2', '11111111-1111-1111-1111-111111111111')$$,
  'owner A can register a device');
select throws_ok('select * from public.platform_admins', '42501', null, 'owner cannot read platform_admins');
select throws_ok('select * from public.audit_log', '42501', null, 'owner cannot read audit_log');
select throws_ok($$insert into public.audit_log (action, entity) values ('fake', 'shops')$$,
  '42501', null, 'owner cannot write audit_log');

-- cashier A: read only, no salaries --------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111112');
select set_eq('select id from public.shops', array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
  'cashier A sees only shop A');
select ok((select count(*) from public.staff) > 0, 'cashier A can read shop A staff');
select is((select count(*) from public.staff_salaries), 0::bigint, 'cashier A sees no salaries');
select is(tests.row_count($$update public.shops set name = 'cashier' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$),
  0::bigint, 'cashier cannot update the shop');
select is(tests.row_count($$update public.staff set name = 'cashier' where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$),
  0::bigint, 'cashier cannot update staff');
select throws_ok(
  $$insert into public.staff (id, shop_id, name, role) values ('aaaaaaaa-0000-0000-0001-000000000098', 'aaaaaaaa-0000-0000-0000-000000000001', 'Friend', 'cashier')$$,
  '42501', null, 'cashier cannot add staff');
select throws_ok(
  $$insert into public.devices (id, shop_id, name, code, registered_by) values ('aaaaaaaa-0000-0000-0002-000000000098', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mine', 'A8', '11111111-1111-1111-1111-111111111112')$$,
  '42501', null, 'cashier cannot register a device');
select throws_ok(
  $$insert into public.staff_salaries (staff_id, shop_id, monthly_salary_paisa) values ('aaaaaaaa-0000-0000-0001-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'cashier cannot set a salary');

-- rider A: same limits ---------------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111113');
select is((select count(*) from public.staff_salaries), 0::bigint, 'rider sees no salaries');
select is(tests.row_count($$update public.devices set name = 'rider' where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$),
  0::bigint, 'rider cannot update devices');

-- signed-in user with no membership --------------------------------------------
select tests.login('33333333-3333-3333-3333-333333333333');
select is((select count(*) from public.shops), 0::bigint, 'non-member sees no shops');
select is((select count(*) from public.staff), 0::bigint, 'non-member sees no staff');

-- platform admin flag ----------------------------------------------------------
select tests.login('44444444-4444-4444-4444-444444444444');
select ok(public.is_platform_admin(), 'is_platform_admin() is true for an admin');
select throws_ok('select * from public.platform_admins', '42501', null,
  'even an admin cannot read platform_admins directly (admin RPCs only)');
select tests.login('11111111-1111-1111-1111-111111111111');
select ok(not public.is_platform_admin(), 'is_platform_admin() is false for an owner');

select * from finish();
rollback;
