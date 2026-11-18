-- create_shop RPC: creates shop + owner membership + owner staff row for the caller.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

insert into auth.users (id, email, aud, role) values
  ('55555555-5555-5555-5555-555555555555', 'new-owner@test.local', 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'other@test.local', 'authenticated', 'authenticated');

select tests.login('55555555-5555-5555-5555-555555555555');
select ok(not public.is_shop_member('dddddddd-0000-0000-0000-000000000001'), 'not a member before create_shop');

select is(
  public.create_shop(
    p_shop_id => 'dddddddd-0000-0000-0000-000000000001',
    p_name => 'Bilal Fruits',
    p_type => 'fruit_veg',
    p_owner_staff_id => 'dddddddd-0000-0000-0001-000000000001',
    p_owner_name => 'Bilal',
    p_owner_phone => '+923001234567',
    p_shop_phone => '+923001234567',
    p_address => 'Main bazaar'),
  'dddddddd-0000-0000-0000-000000000001'::uuid,
  'create_shop returns the shop id');

select results_eq(
  'select name, type, status, timezone, cashier_expense_limit_paisa from public.shops',
  $$values ('Bilal Fruits'::text, 'fruit_veg'::text, 'active'::text, 'Asia/Karachi'::text, 200000::bigint)$$,
  'shop row is created with defaults and visible to the caller');
select results_eq(
  'select user_id, role from public.memberships',
  $$values ('55555555-5555-5555-5555-555555555555'::uuid, 'owner'::text)$$,
  'caller gets an owner membership');
select results_eq(
  'select id, name, phone, role, membership_user_id, active from public.staff',
  $$values ('dddddddd-0000-0000-0001-000000000001'::uuid, 'Bilal'::text, '+923001234567'::text, 'owner'::text,
            '55555555-5555-5555-5555-555555555555'::uuid, true)$$,
  'caller gets an owner staff row linked to their user');
select ok(public.is_shop_member('dddddddd-0000-0000-0000-000000000001'), 'caller is a member');
select ok(public.has_shop_role('dddddddd-0000-0000-0000-000000000001', array['owner']), 'caller has the owner role');
select ok(not public.has_shop_role('dddddddd-0000-0000-0000-000000000001', array['cashier', 'rider']),
  'caller has no other role');

-- retry after a lost response
select is(
  public.create_shop('dddddddd-0000-0000-0000-000000000001', 'Bilal Fruits', 'fruit_veg',
    'dddddddd-0000-0000-0001-000000000001', 'Bilal', '+923001234567', '+923001234567'),
  'dddddddd-0000-0000-0000-000000000001'::uuid,
  'retry returns the same id');
select is((select count(*) from public.staff), 1::bigint, 'retry does not duplicate staff');
select is((select count(*) from public.memberships), 1::bigint, 'retry does not duplicate memberships');

select throws_ok(
  $$select public.create_shop('eeeeeeee-0000-0000-0000-000000000001', 'Bad', 'bakery',
    'eeeeeeee-0000-0000-0001-000000000001', 'X', null, null)$$,
  '23514', null, 'invalid shop type is rejected');

-- another user cannot take over an existing shop id
select tests.login('66666666-6666-6666-6666-666666666666');
select throws_ok(
  $$select public.create_shop('dddddddd-0000-0000-0000-000000000001', 'Mine now', 'grocery',
    'dddddddd-0000-0000-0001-000000000099', 'Thief', null, null)$$,
  '23505', null, 'another user cannot reuse an existing shop id');
select ok(not public.is_shop_member('dddddddd-0000-0000-0000-000000000001'), 'other user did not become a member');

-- not signed in
select tests.login_anon();
select throws_ok(
  $$select public.create_shop('ffffffff-0000-0000-0000-000000000001', 'Anon', 'meat',
    'ffffffff-0000-0000-0001-000000000001', 'X', null, null)$$,
  '42501', null, 'anon cannot call create_shop');

-- authenticated role but no user id in the token
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_shop('ffffffff-0000-0000-0000-000000000002', 'Ghost', 'meat',
    'ffffffff-0000-0000-0001-000000000002', 'X', null, null)$$,
  '42501', 'create_shop: not signed in', 'create_shop requires a signed-in user');

reset role;
select results_eq(
  $$select action, actor_user_id, acting_as_admin from public.audit_log where shop_id = 'dddddddd-0000-0000-0000-000000000001'$$,
  $$values ('shop.create'::text, '55555555-5555-5555-5555-555555555555'::uuid, false)$$,
  'create_shop writes one audit_log row');

select * from finish();
rollback;
