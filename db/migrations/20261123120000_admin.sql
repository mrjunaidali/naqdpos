-- migrate:up
-- Admin portal, part 1 (US010, US011; architecture §5).
-- 1. shops.suspended_at and shops.city (approved 22 Nov 2026). Suspension never loses data:
--    sync_push refuses ledger rows created after suspended_at ('shop_suspended'); rows created
--    before are accepted. Reactivating clears it.
-- 2. admin_session_2fa (approved): the sessions that passed TOTP. Better Auth's two-factor step
--    only covers password sign-in, and admins sign in with Google or an email code, so /admin/*
--    also needs this row. No grants: only the functions below touch it.
-- 3. Admin data access only through security-definer functions that check is_platform_admin()
--    first and audit every write (acting_as_admin = true). Tenant RLS is unchanged.

alter table public.shops
  add column suspended_at timestamptz,
  add column city text constraint shops_city_length check (city is null or length(trim(city)) between 1 and 60);
grant update (city) on public.shops to naqdpos_app;
update public.sync_tables set push_columns = push_columns || array['city'] where table_name = 'shops';

create table public.admin_session_2fa (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table public.admin_session_2fa enable row level security;
revoke all on public.admin_session_2fa from public;

-- Admin sessions last 12 hours from sign-in (owners keep 90 days).
create function public.admin_session_ok(p_session_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_enabled boolean;
begin
  select * into v_session from public.sessions s where s.id = p_session_id;
  if not found or v_session.user_id is distinct from public.current_user_id() then
    return 'no_session';
  end if;
  if not public.is_platform_admin() then return 'admin_required'; end if;
  if v_session.created_at < now() - interval '12 hours' or v_session.expires_at < now() then
    return 'session_expired';
  end if;
  select u.two_factor_enabled into v_enabled from public.users u where u.id = v_session.user_id;
  if not coalesce(v_enabled, false) then return 'two_factor_setup'; end if;
  if not exists (select 1 from public.admin_session_2fa a where a.session_id = p_session_id) then
    return 'two_factor_required';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.admin_session_ok(uuid) from public;
grant execute on function public.admin_session_ok(uuid) to naqdpos_app;

-- Called by the API after Better Auth confirmed a TOTP or backup code for this session.
create function public.admin_mark_session_verified(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
      select 1 from public.sessions s
      where s.id = p_session_id and s.user_id = public.current_user_id()) then
    raise exception 'not your session' using errcode = 'insufficient_privilege';
  end if;
  -- Expired sessions' rows go with them (on delete cascade); stale rows are cleaned here too.
  delete from public.admin_session_2fa a
  using public.sessions s
  where s.id = a.session_id and s.expires_at < now();
  insert into public.admin_session_2fa (session_id) values (p_session_id)
  on conflict (session_id) do update set verified_at = now();
  insert into public.audit_log (actor_user_id, acting_as_admin, action, entity, entity_id)
  values (public.current_user_id(), true, 'admin.2fa_verified', 'sessions', p_session_id);
end;
$$;
revoke all on function public.admin_mark_session_verified(uuid) from public;
grant execute on function public.admin_mark_session_verified(uuid) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- Shop list, detail, status (admins only)
-- ---------------------------------------------------------------------------
create function public.admin_list_shops(p_filters jsonb, p_page integer, p_page_size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(trim(p_filters ->> 'q'), '');
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_rows jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  with base as (
    select s.*,
      (select u.email from public.memberships m join public.users u on u.id = m.user_id
        where m.shop_id = s.id and m.role = 'owner' order by m.created_at limit 1) as owner_email
    from public.shops s
    where s.deleted_at is null
      and (p_filters ->> 'status' is null or s.status = p_filters ->> 'status')
      and (p_filters ->> 'type' is null or s.type = p_filters ->> 'type')
      and (p_filters ->> 'city' is null or lower(s.city) = lower(p_filters ->> 'city'))
  ), matched as (
    select * from base b
    where v_q is null
      or b.name ilike '%' || v_q || '%'
      or coalesce(b.phone, '') ilike '%' || v_q || '%'
      or coalesce(b.owner_email, '') ilike '%' || v_q || '%'
  )
  select count(*) into v_total from matched;

  with base as (
    select s.*,
      (select u.email from public.memberships m join public.users u on u.id = m.user_id
        where m.shop_id = s.id and m.role = 'owner' order by m.created_at limit 1) as owner_email
    from public.shops s
    where s.deleted_at is null
      and (p_filters ->> 'status' is null or s.status = p_filters ->> 'status')
      and (p_filters ->> 'type' is null or s.type = p_filters ->> 'type')
      and (p_filters ->> 'city' is null or lower(s.city) = lower(p_filters ->> 'city'))
  ), page as (
    select * from base b
    where v_q is null
      or b.name ilike '%' || v_q || '%'
      or coalesce(b.phone, '') ilike '%' || v_q || '%'
      or coalesce(b.owner_email, '') ilike '%' || v_q || '%'
    order by b.created_at desc, b.id
    limit v_size offset (v_page - 1) * v_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'type', p.type, 'city', p.city, 'status', p.status,
      'phone', p.phone, 'owner_email', p.owner_email, 'created_at', p.created_at,
      'devices', (select count(*) from public.devices d where d.shop_id = p.id and d.deleted_at is null),
      'last_sync_at', (select max(d.last_sync_at) from public.devices d where d.shop_id = p.id),
      'last_sale_date', (select max(x.business_date) from public.sales x where x.shop_id = p.id),
      'sales_7d', (select count(*) from public.sales x where x.shop_id = p.id
                    and x.business_date > (now() at time zone p.timezone)::date - 7)
    ) order by p.created_at desc, p.id), '[]'::jsonb)
  into v_rows from page p;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size);
end;
$$;
revoke all on function public.admin_list_shops(jsonb, integer, integer) from public;
grant execute on function public.admin_list_shops(jsonb, integer, integer) to naqdpos_app;

create function public.admin_get_shop(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
begin
  if not public.is_platform_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  select * into v_shop from public.shops s where s.id = p_shop_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', v_shop.id, 'name', v_shop.name, 'type', v_shop.type, 'city', v_shop.city,
      'address', v_shop.address, 'phone', v_shop.phone, 'status', v_shop.status,
      'suspended_at', v_shop.suspended_at, 'timezone', v_shop.timezone, 'created_at', v_shop.created_at,
      'owner_email', (select u.email from public.memberships m join public.users u on u.id = m.user_id
        where m.shop_id = v_shop.id and m.role = 'owner' order by m.created_at limit 1)),
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'code', d.code, 'name', d.name, 'mode', d.mode, 'last_sync_at', d.last_sync_at,
        'retired', d.deleted_at is not null) order by d.code)
      from public.devices d where d.shop_id = v_shop.id), '[]'::jsonb),
    -- Names and roles only: never PIN data.
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'role', s.role, 'active', s.active and s.deleted_at is null)
        order by s.role, s.name)
      from public.staff s where s.shop_id = v_shop.id), '[]'::jsonb),
    'conflicts', coalesce((select jsonb_agg(c order by c.created_at desc) from (
        select sc.id, sc.table_name, sc.row_id, sc.incoming_updated_at, sc.server_updated_at, sc.at as created_at
        from public.sync_conflicts sc where sc.shop_id = v_shop.id
        order by sc.at desc limit 50) c), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(a order by a.at desc) from (
        select al.id, al.action, al.entity, al.entity_id, al.acting_as_admin, al.payload, al.at,
          (select u.email from public.users u where u.id = al.actor_user_id) as actor_email
        from public.audit_log al where al.shop_id = v_shop.id
        order by al.at desc limit 100) a), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_get_shop(uuid) from public;
grant execute on function public.admin_get_shop(uuid) to naqdpos_app;

create function public.admin_set_shop_status(p_shop_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  if not public.is_platform_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'status must be active or suspended' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select s.status into v_from from public.shops s where s.id = p_shop_id for update;
  if not found then raise exception 'shop not found' using errcode = 'no_data_found'; end if;
  update public.shops
  set status = p_status,
      suspended_at = case when p_status = 'suspended' then coalesce(suspended_at, now()) else null end,
      updated_at = now()
  where id = p_shop_id;
  insert into public.audit_log (shop_id, actor_user_id, acting_as_admin, action, entity, entity_id, payload)
  values (p_shop_id, public.current_user_id(), true,
    case when p_status = 'suspended' then 'shop.suspend' else 'shop.reactivate' end,
    'shops', p_shop_id, jsonb_build_object('reason', trim(p_reason), 'from', v_from, 'to', p_status));
  return jsonb_build_object('id', p_shop_id, 'status', p_status);
end;
$$;
revoke all on function public.admin_set_shop_status(uuid, text, text) from public;
grant execute on function public.admin_set_shop_status(uuid, text, text) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- Granting admin: only the CLI (owner role through DATABASE_ADMIN_URL), never an API route.
-- ---------------------------------------------------------------------------
create function public.admin_grant(p_email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user from public.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no user with that email: sign in once first' using errcode = 'no_data_found';
  end if;
  insert into public.platform_admins (user_id) values (v_user) on conflict do nothing;
  insert into public.audit_log (actor_user_id, acting_as_admin, action, entity, entity_id, payload)
  values (null, true, 'admin.grant', 'users', v_user, jsonb_build_object('email', lower(trim(p_email)), 'via', 'cli'));
  return v_user;
end;
$$;
revoke all on function public.admin_grant(text) from public;

create function public.admin_revoke(p_email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user from public.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no user with that email' using errcode = 'no_data_found';
  end if;
  delete from public.platform_admins where user_id = v_user;
  delete from public.admin_session_2fa a using public.sessions s where s.id = a.session_id and s.user_id = v_user;
  insert into public.audit_log (actor_user_id, acting_as_admin, action, entity, entity_id, payload)
  values (null, true, 'admin.revoke', 'users', v_user, jsonb_build_object('email', lower(trim(p_email)), 'via', 'cli'));
  return v_user;
end;
$$;
revoke all on function public.admin_revoke(text) from public;

-- ---------------------------------------------------------------------------
-- sync_push: as in 20261123090000_day_closes, plus 'shop_suspended' for ledger rows created
-- after the shop was suspended.
-- ---------------------------------------------------------------------------
create or replace function public.sync_push(p_device_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_device public.devices := public.sync_device(p_device_id);
  -- Device clocks may drift a little; far-future timestamps would win every LWW comparison.
  v_max_ts timestamptz := now() + interval '10 minutes';
  v_accepted jsonb := '[]';
  v_conflicts jsonb := '[]';
  v_errors jsonb := '[]';
  v_entry jsonb;
  v_entry_id text;
  v_row jsonb;
  v_reg public.sync_tables;
  v_code text;
  v_message text;
  v_cols text[];
  v_upd_cols text[];
  v_col_list text;
  v_server jsonb;
  v_incoming jsonb;
  v_in_ts timestamptz;
  v_srv_ts timestamptz;
  v_device_suspended_at timestamptz;
begin
  select s.suspended_at into v_device_suspended_at from public.shops s where s.id = v_device.shop_id;
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'sync_push: entries must be an array' using errcode = '22023';
  end if;

  for v_entry in select e from jsonb_array_elements(p_entries) e loop
    v_entry_id := v_entry ->> 'id';
    v_row := v_entry -> 'row';
    v_code := null;
    v_message := null;
    v_server := null;

    -- The acting staff member, for table triggers (e.g. stock_movements per-reason rules).
    perform set_config('app.actor_staff_id', coalesce(v_entry ->> 'actor_staff_id', ''), true);

    begin
      select * into v_reg from public.sync_tables t where t.table_name = v_entry ->> 'table';
      if not found then
        v_code := 'unknown_table';
      elsif not v_reg.pushable then
        v_code := 'not_pushable';
      elsif not public.sync_scope_allows(v_reg.pull_scope, v_device.mode) then
        v_code := 'forbidden';
        v_message := 'not allowed on this device mode';
      elsif v_reg.write_roles is not null and not exists (
          select 1 from public.staff s
          where s.id = (v_entry ->> 'actor_staff_id')::uuid
            and s.shop_id = v_device.shop_id
            and s.active
            and s.deleted_at is null
            and s.role = any (v_reg.write_roles)) then
        v_code := 'forbidden';
        v_message := 'the acting staff member may not change this';
      elsif jsonb_typeof(v_row) is distinct from 'object'
        or (v_row ->> v_reg.id_column) is null then
        v_code := 'invalid';
        v_message := 'row or its id is missing';
      elsif (v_row ->> v_reg.shop_column) is distinct from v_device.shop_id::text then
        v_code := 'other_shop';
      elsif v_reg.kind = 'mutable' and (v_row ->> 'updated_at')::timestamptz > v_max_ts then
        v_code := 'clock_ahead';
      elsif v_reg.kind = 'append' and (v_row ->> 'created_at')::timestamptz > v_max_ts then
        v_code := 'clock_ahead';
      elsif v_device_suspended_at is not null
        and v_reg.table_name in ('sales', 'sale_lines', 'payments', 'khata_entries', 'expenses', 'stock_movements')
        and (v_row ->> 'created_at')::timestamptz > v_device_suspended_at then
        -- Suspended shop (US011): no new ledger rows; rows made before the suspension still sync.
        v_code := 'shop_suspended';
      -- Late rows for a closed date are accepted (architecture §4); 'day_closed' is reserved.
      else
        -- Only allowed columns the device actually sent: an older app that omits a newer column
        -- gets the column default on insert and leaves it alone on update (§4 compatibility).
        select array_agg(c order by c) into v_cols
        from unnest(v_reg.push_columns) c where v_row ? c;
        v_col_list := (select string_agg(format('%I', c), ', ') from unnest(v_cols) c);

        if v_reg.kind = 'append' then
          execute format(
            'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)
             on conflict (%3$I) do nothing',
            v_reg.table_name, v_col_list, v_reg.id_column)
          using v_row;
        else
          execute format('select to_jsonb(t) from public.%1$I t where t.%2$I = $1::uuid for update',
            v_reg.table_name, v_reg.id_column)
          into v_server using v_row ->> v_reg.id_column;

          if v_server is null then
            execute format(
              'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
              v_reg.table_name, v_col_list)
            using v_row;
          elsif (v_server ->> v_reg.shop_column) is distinct from v_device.shop_id::text then
            v_code := 'other_shop'; -- a member of two shops sending shop B's row from shop A
          else
            v_in_ts := (v_row ->> 'updated_at')::timestamptz;
            v_srv_ts := (v_server ->> 'updated_at')::timestamptz;
            -- Normalise the incoming row through the table type so it compares like for like.
            execute format('select to_jsonb(r) from jsonb_populate_record(null::public.%I, $1) r',
              v_reg.table_name)
            into v_incoming using v_row;

            if v_in_ts > v_srv_ts then
              select array_agg(c) into v_upd_cols
              from unnest(v_cols) c where c not in (v_reg.id_column, v_reg.shop_column);
              if v_upd_cols is not null then
                execute format(
                  'update public.%1$I t set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1))
                   where t.%3$I = $2::uuid',
                  v_reg.table_name,
                  (select string_agg(format('%I', c), ', ') from unnest(v_upd_cols) c),
                  v_reg.id_column)
                using v_row, v_row ->> v_reg.id_column;
              end if;
            elsif v_in_ts = v_srv_ts
              and (select jsonb_object_agg(c, v_incoming -> c) from unnest(v_cols) c)
                = (select jsonb_object_agg(c, v_server -> c) from unnest(v_cols) c) then
              null; -- the same edit sent again (lost response, retried batch): nothing to do
            else
              insert into public.sync_conflicts
                (shop_id, device_id, table_name, row_id, incoming, incoming_updated_at,
                 server_updated_at)
              values (v_device.shop_id, v_device.id, v_reg.table_name,
                (v_row ->> v_reg.id_column)::uuid, v_row, v_in_ts, v_srv_ts);
              v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'id', v_entry_id, 'table', v_reg.table_name, 'row', v_server));
              v_code := 'conflict';
            end if;
          end if;
        end if;
      end if;
    exception
      when foreign_key_violation then
        -- The parent row is not there yet (a line before its sale, a sale using a product made
        -- offline): the device keeps the entry and retries it (architecture §4).
        v_code := 'missing_parent';
        v_message := sqlerrm;
      when insufficient_privilege then -- RLS or a missing grant (e.g. inserting a shop)
        v_code := 'forbidden';
        v_message := sqlerrm;
      when others then
        v_code := 'invalid';
        v_message := sqlstate || ': ' || sqlerrm;
    end;

    if v_code is null then
      v_accepted := v_accepted || jsonb_build_array(v_entry_id);
    elsif v_code <> 'conflict' then
      v_errors := v_errors || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id', v_entry_id, 'code', v_code, 'message', v_message)));
    end if;
  end loop;

  perform set_config('app.actor_staff_id', '', true);
  perform public.sync_mark_device(p_device_id);

  return jsonb_build_object('accepted', v_accepted, 'conflicts', v_conflicts, 'errors', v_errors);
end;
$$;
revoke all on function public.sync_push(uuid, jsonb) from public;
grant execute on function public.sync_push(uuid, jsonb) to naqdpos_app;

-- migrate:down
create or replace function public.sync_push(p_device_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_device public.devices := public.sync_device(p_device_id);
  -- Device clocks may drift a little; far-future timestamps would win every LWW comparison.
  v_max_ts timestamptz := now() + interval '10 minutes';
  v_accepted jsonb := '[]';
  v_conflicts jsonb := '[]';
  v_errors jsonb := '[]';
  v_entry jsonb;
  v_entry_id text;
  v_row jsonb;
  v_reg public.sync_tables;
  v_code text;
  v_message text;
  v_cols text[];
  v_upd_cols text[];
  v_col_list text;
  v_server jsonb;
  v_incoming jsonb;
  v_in_ts timestamptz;
  v_srv_ts timestamptz;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'sync_push: entries must be an array' using errcode = '22023';
  end if;

  for v_entry in select e from jsonb_array_elements(p_entries) e loop
    v_entry_id := v_entry ->> 'id';
    v_row := v_entry -> 'row';
    v_code := null;
    v_message := null;
    v_server := null;

    -- The acting staff member, for table triggers (e.g. stock_movements per-reason rules).
    perform set_config('app.actor_staff_id', coalesce(v_entry ->> 'actor_staff_id', ''), true);

    begin
      select * into v_reg from public.sync_tables t where t.table_name = v_entry ->> 'table';
      if not found then
        v_code := 'unknown_table';
      elsif not v_reg.pushable then
        v_code := 'not_pushable';
      elsif not public.sync_scope_allows(v_reg.pull_scope, v_device.mode) then
        v_code := 'forbidden';
        v_message := 'not allowed on this device mode';
      elsif v_reg.write_roles is not null and not exists (
          select 1 from public.staff s
          where s.id = (v_entry ->> 'actor_staff_id')::uuid
            and s.shop_id = v_device.shop_id
            and s.active
            and s.deleted_at is null
            and s.role = any (v_reg.write_roles)) then
        v_code := 'forbidden';
        v_message := 'the acting staff member may not change this';
      elsif jsonb_typeof(v_row) is distinct from 'object'
        or (v_row ->> v_reg.id_column) is null then
        v_code := 'invalid';
        v_message := 'row or its id is missing';
      elsif (v_row ->> v_reg.shop_column) is distinct from v_device.shop_id::text then
        v_code := 'other_shop';
      elsif v_reg.kind = 'mutable' and (v_row ->> 'updated_at')::timestamptz > v_max_ts then
        v_code := 'clock_ahead';
      elsif v_reg.kind = 'append' and (v_row ->> 'created_at')::timestamptz > v_max_ts then
        v_code := 'clock_ahead';
      -- Late rows for a closed date are accepted (architecture §4); 'day_closed' is reserved.
      else
        -- Only allowed columns the device actually sent: an older app that omits a newer column
        -- gets the column default on insert and leaves it alone on update (§4 compatibility).
        select array_agg(c order by c) into v_cols
        from unnest(v_reg.push_columns) c where v_row ? c;
        v_col_list := (select string_agg(format('%I', c), ', ') from unnest(v_cols) c);

        if v_reg.kind = 'append' then
          execute format(
            'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)
             on conflict (%3$I) do nothing',
            v_reg.table_name, v_col_list, v_reg.id_column)
          using v_row;
        else
          execute format('select to_jsonb(t) from public.%1$I t where t.%2$I = $1::uuid for update',
            v_reg.table_name, v_reg.id_column)
          into v_server using v_row ->> v_reg.id_column;

          if v_server is null then
            execute format(
              'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
              v_reg.table_name, v_col_list)
            using v_row;
          elsif (v_server ->> v_reg.shop_column) is distinct from v_device.shop_id::text then
            v_code := 'other_shop'; -- a member of two shops sending shop B's row from shop A
          else
            v_in_ts := (v_row ->> 'updated_at')::timestamptz;
            v_srv_ts := (v_server ->> 'updated_at')::timestamptz;
            -- Normalise the incoming row through the table type so it compares like for like.
            execute format('select to_jsonb(r) from jsonb_populate_record(null::public.%I, $1) r',
              v_reg.table_name)
            into v_incoming using v_row;

            if v_in_ts > v_srv_ts then
              select array_agg(c) into v_upd_cols
              from unnest(v_cols) c where c not in (v_reg.id_column, v_reg.shop_column);
              if v_upd_cols is not null then
                execute format(
                  'update public.%1$I t set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1))
                   where t.%3$I = $2::uuid',
                  v_reg.table_name,
                  (select string_agg(format('%I', c), ', ') from unnest(v_upd_cols) c),
                  v_reg.id_column)
                using v_row, v_row ->> v_reg.id_column;
              end if;
            elsif v_in_ts = v_srv_ts
              and (select jsonb_object_agg(c, v_incoming -> c) from unnest(v_cols) c)
                = (select jsonb_object_agg(c, v_server -> c) from unnest(v_cols) c) then
              null; -- the same edit sent again (lost response, retried batch): nothing to do
            else
              insert into public.sync_conflicts
                (shop_id, device_id, table_name, row_id, incoming, incoming_updated_at,
                 server_updated_at)
              values (v_device.shop_id, v_device.id, v_reg.table_name,
                (v_row ->> v_reg.id_column)::uuid, v_row, v_in_ts, v_srv_ts);
              v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'id', v_entry_id, 'table', v_reg.table_name, 'row', v_server));
              v_code := 'conflict';
            end if;
          end if;
        end if;
      end if;
    exception
      when foreign_key_violation then
        -- The parent row is not there yet (a line before its sale, a sale using a product made
        -- offline): the device keeps the entry and retries it (architecture §4).
        v_code := 'missing_parent';
        v_message := sqlerrm;
      when insufficient_privilege then -- RLS or a missing grant (e.g. inserting a shop)
        v_code := 'forbidden';
        v_message := sqlerrm;
      when others then
        v_code := 'invalid';
        v_message := sqlstate || ': ' || sqlerrm;
    end;

    if v_code is null then
      v_accepted := v_accepted || jsonb_build_array(v_entry_id);
    elsif v_code <> 'conflict' then
      v_errors := v_errors || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id', v_entry_id, 'code', v_code, 'message', v_message)));
    end if;
  end loop;

  perform set_config('app.actor_staff_id', '', true);
  perform public.sync_mark_device(p_device_id);

  return jsonb_build_object('accepted', v_accepted, 'conflicts', v_conflicts, 'errors', v_errors);
end;
$$;
revoke all on function public.sync_push(uuid, jsonb) from public;
grant execute on function public.sync_push(uuid, jsonb) to naqdpos_app;

drop function public.admin_revoke(text);
drop function public.admin_grant(text);
drop function public.admin_set_shop_status(uuid, text, text);
drop function public.admin_get_shop(uuid);
drop function public.admin_list_shops(jsonb, integer, integer);
drop function public.admin_mark_session_verified(uuid);
drop function public.admin_session_ok(uuid);
drop table public.admin_session_2fa;
update public.sync_tables set push_columns = array_remove(push_columns, 'city') where table_name = 'shops';
alter table public.shops drop column city, drop column suspended_at;
