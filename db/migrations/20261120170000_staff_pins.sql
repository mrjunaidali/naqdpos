-- migrate:up

-- Staff PINs and acting-staff checks (docs/progress.md Step 6; architecture §3, §4, §5).
-- 1. staff_pins: PIN hashes move out of staff into their own table (same pattern as
--    staff_salaries). Owners and cashiers read them, riders only their own; only owner and shop
--    devices pull them (pull_scope 'counter_device'), so rider devices never hold other staff
--    members' hashes. staff.pin_hash stays for old apps but is emptied and no longer pushable.
-- 2. sync_tables.write_roles: a shop device runs on the owner's session, so RLS alone cannot
--    tell a PIN-switched cashier from the owner. Each pushed entry names its acting staff
--    member; tables with write_roles accept it only from an active staff member of the device's
--    shop with one of those roles. The PIN is checked offline on the device, so this guards
--    against a buggy or tampered UI, not against someone who controls the device.

-- ---------------------------------------------------------------------------
-- staff_pins
-- ---------------------------------------------------------------------------
create table public.staff_pins (
  staff_id uuid primary key,
  shop_id uuid not null references public.shops (id),
  pin_hash text not null
    check (pin_hash ~ '^pbkdf2-sha256\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  -- composite FK: a PIN can never point at another shop's staff member
  foreign key (staff_id, shop_id) references public.staff (id, shop_id)
);
create index staff_pins_shop_id_idx on public.staff_pins (shop_id);
create index staff_pins_server_seq_idx on public.staff_pins (server_seq);
alter table public.staff_pins enable row level security;
create trigger set_server_seq before insert or update on public.staff_pins
  for each row execute function public.set_server_seq();

revoke all on public.staff_pins from public;
grant select, insert, update on public.staff_pins to naqdpos_app;

create policy staff_pins_select on public.staff_pins
  for select to naqdpos_app using (
    public.has_shop_role(shop_id, array['owner', 'cashier'])
    -- a rider reads only their own PIN
    or exists (
      select 1 from public.staff s
      where s.id = staff_pins.staff_id
        and s.membership_user_id = (select public.current_user_id())
    )
  );
create policy staff_pins_insert_owner on public.staff_pins
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));
create policy staff_pins_update_owner on public.staff_pins
  for update to naqdpos_app
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

-- Move existing hashes. Emptying staff.pin_hash bumps those rows' server_seq, so devices pull
-- the emptied rows too.
insert into public.staff_pins (staff_id, shop_id, pin_hash, device_id)
select s.id, s.shop_id, s.pin_hash, s.device_id from public.staff s where s.pin_hash is not null;
update public.staff set pin_hash = null where pin_hash is not null;

-- ---------------------------------------------------------------------------
-- Registry: device scopes and write roles
-- ---------------------------------------------------------------------------
alter table public.sync_tables drop constraint sync_tables_pull_scope_check;
alter table public.sync_tables add constraint sync_tables_pull_scope_check
  check (pull_scope in ('all', 'owner_device', 'counter_device'));
-- null = any role; otherwise the acting staff member must have one of these roles
alter table public.sync_tables add column write_roles text[];

update public.sync_tables
set push_columns = array_remove(push_columns, 'pin_hash'), write_roles = array['owner']
where table_name = 'staff';
update public.sync_tables set write_roles = array['owner']
where table_name in ('shops', 'staff_salaries');

insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope, write_roles)
values
  ('staff_pins', 'mutable', 'staff_id', 'shop_id', true,
    array['staff_id', 'shop_id', 'pin_hash', 'created_at', 'updated_at', 'deleted_at',
      'device_id'],
    'counter_device', array['owner']);

-- Which devices a pull_scope admits; the same rule for pull and push.
create function public.sync_scope_allows(p_scope text, p_mode text)
returns boolean
language sql
immutable
as $$
  select case p_scope
    when 'all' then true
    when 'owner_device' then p_mode = 'owner'
    when 'counter_device' then p_mode in ('owner', 'shop')
    else false
  end;
$$;
revoke all on function public.sync_scope_allows(text, text) from public;
grant execute on function public.sync_scope_allows(text, text) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- create_shop: same signature as 20261120090000_onboarding; the owner's PIN now goes to
-- staff_pins.
-- ---------------------------------------------------------------------------
create or replace function public.create_shop(
  p_shop_id uuid,
  p_name text,
  p_type text,
  p_owner_staff_id uuid,
  p_owner_name text,
  p_owner_phone text,
  p_shop_phone text,
  p_owner_pin_hash text,
  p_address text default null,
  p_device_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
begin
  if v_uid is null then
    raise exception 'create_shop: not signed in' using errcode = '42501';
  end if;

  if exists (select 1 from public.shops s where s.id = p_shop_id) then
    if exists (
      select 1 from public.memberships m
      where m.shop_id = p_shop_id and m.user_id = v_uid and m.role = 'owner'
    ) then
      return p_shop_id; -- retry of a request that already succeeded
    end if;
    raise exception 'create_shop: shop id already in use' using errcode = '23505';
  end if;

  insert into public.shops (id, name, type, phone, address, device_id)
  values (p_shop_id, p_name, p_type, p_shop_phone, p_address, p_device_id);

  insert into public.memberships (shop_id, user_id, role)
  values (p_shop_id, v_uid, 'owner');

  insert into public.staff (id, shop_id, name, phone, role, membership_user_id, device_id)
  values (p_owner_staff_id, p_shop_id, p_owner_name, p_owner_phone, 'owner', v_uid, p_device_id);

  insert into public.staff_pins (staff_id, shop_id, pin_hash, device_id)
  values (p_owner_staff_id, p_shop_id, p_owner_pin_hash, p_device_id);

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'shop.create', 'shops', p_shop_id,
    jsonb_build_object('name', p_name, 'type', p_type, 'owner_staff_id', p_owner_staff_id));

  return p_shop_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_push: as in 20261120150000_sync, plus the device-scope rule for every scope and the
-- acting-staff check (entries carry actor_staff_id).
-- sync_pull: as before, with sync_scope_allows().
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
      elsif v_row ? 'business_date'
        and public.is_day_closed(v_device.shop_id, (v_row ->> 'business_date')::date) then
        v_code := 'day_closed';
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

  perform public.sync_mark_device(p_device_id);

  return jsonb_build_object('accepted', v_accepted, 'conflicts', v_conflicts, 'errors', v_errors);
end;
$$;
revoke all on function public.sync_push(uuid, jsonb) from public;
grant execute on function public.sync_push(uuid, jsonb) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- sync_pull(device_id, since_seq, limit): rows of the device's shop with server_seq > since_seq,
-- ordered by server_seq (§4). RLS limits rows to what the user may see; owner_device tables are
-- skipped unless the device's mode is 'owner'.
-- returns: { rows: [{ table, row, server_seq }], next_seq, has_more }
-- ---------------------------------------------------------------------------
create or replace function public.sync_pull(p_device_id uuid, p_since_seq bigint, p_limit integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_device public.devices := public.sync_device(p_device_id);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_union text;
  v_rows jsonb;
  v_has_more boolean;
  v_next bigint;
begin
  select string_agg(format(
      'select %1$L as tbl, to_jsonb(t) as r, t.server_seq as seq from public.%1$I t
       where t.server_seq > $1 and t.%2$I = $2',
      t.table_name, t.shop_column), ' union all ')
  into v_union
  from public.sync_tables t
  where public.sync_scope_allows(t.pull_scope, v_device.mode);

  -- One extra row tells whether another page exists.
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''table'', tbl, ''row'', r, ''server_seq'', seq)
       order by seq), ''[]'')
     from (select * from (%s) u order by seq limit $3) p',
    v_union)
  into v_rows using p_since_seq, v_device.shop_id, v_limit + 1;

  v_has_more := jsonb_array_length(v_rows) > v_limit;
  if v_has_more then
    v_rows := v_rows - v_limit; -- drop the extra row (0-based index)
  end if;
  v_next := coalesce((v_rows -> -1 ->> 'server_seq')::bigint, p_since_seq);

  perform public.sync_mark_device(p_device_id, v_next);

  return jsonb_build_object('rows', v_rows, 'next_seq', v_next, 'has_more', v_has_more);
end;
$$;
revoke all on function public.sync_pull(uuid, bigint, integer) from public;
grant execute on function public.sync_pull(uuid, bigint, integer) to naqdpos_app;

-- migrate:down

-- Restore the 20261120150000_sync versions (they no longer know write_roles or counter_device).
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

    begin
      select * into v_reg from public.sync_tables t where t.table_name = v_entry ->> 'table';
      if not found then
        v_code := 'unknown_table';
      elsif not v_reg.pushable then
        v_code := 'not_pushable';
      elsif v_reg.pull_scope = 'owner_device' and v_device.mode <> 'owner' then
        v_code := 'forbidden';
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
      elsif v_row ? 'business_date'
        and public.is_day_closed(v_device.shop_id, (v_row ->> 'business_date')::date) then
        v_code := 'day_closed';
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

  perform public.sync_mark_device(p_device_id);

  return jsonb_build_object('accepted', v_accepted, 'conflicts', v_conflicts, 'errors', v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_pull(device_id, since_seq, limit): rows of the device's shop with server_seq > since_seq,
-- ordered by server_seq (§4). RLS limits rows to what the user may see; owner_device tables are
-- skipped unless the device's mode is 'owner'.
-- returns: { rows: [{ table, row, server_seq }], next_seq, has_more }
-- ---------------------------------------------------------------------------
create or replace function public.sync_pull(p_device_id uuid, p_since_seq bigint, p_limit integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_device public.devices := public.sync_device(p_device_id);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_union text;
  v_rows jsonb;
  v_has_more boolean;
  v_next bigint;
begin
  select string_agg(format(
      'select %1$L as tbl, to_jsonb(t) as r, t.server_seq as seq from public.%1$I t
       where t.server_seq > $1 and t.%2$I = $2',
      t.table_name, t.shop_column), ' union all ')
  into v_union
  from public.sync_tables t
  where t.pull_scope = 'all' or (t.pull_scope = 'owner_device' and v_device.mode = 'owner');

  -- One extra row tells whether another page exists.
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''table'', tbl, ''row'', r, ''server_seq'', seq)
       order by seq), ''[]'')
     from (select * from (%s) u order by seq limit $3) p',
    v_union)
  into v_rows using p_since_seq, v_device.shop_id, v_limit + 1;

  v_has_more := jsonb_array_length(v_rows) > v_limit;
  if v_has_more then
    v_rows := v_rows - v_limit; -- drop the extra row (0-based index)
  end if;
  v_next := coalesce((v_rows -> -1 ->> 'server_seq')::bigint, p_since_seq);

  perform public.sync_mark_device(p_device_id, v_next);

  return jsonb_build_object('rows', v_rows, 'next_seq', v_next, 'has_more', v_has_more);
end;
$$;


-- create_shop back to writing staff.pin_hash.
create or replace function public.create_shop(
  p_shop_id uuid,
  p_name text,
  p_type text,
  p_owner_staff_id uuid,
  p_owner_name text,
  p_owner_phone text,
  p_shop_phone text,
  p_owner_pin_hash text,
  p_address text default null,
  p_device_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
begin
  if v_uid is null then
    raise exception 'create_shop: not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from public.shops s where s.id = p_shop_id) then
    if exists (
      select 1 from public.memberships m
      where m.shop_id = p_shop_id and m.user_id = v_uid and m.role = 'owner'
    ) then
      return p_shop_id;
    end if;
    raise exception 'create_shop: shop id already in use' using errcode = '23505';
  end if;
  insert into public.shops (id, name, type, phone, address, device_id)
  values (p_shop_id, p_name, p_type, p_shop_phone, p_address, p_device_id);
  insert into public.memberships (shop_id, user_id, role)
  values (p_shop_id, v_uid, 'owner');
  insert into public.staff (id, shop_id, name, phone, role, pin_hash, membership_user_id, device_id)
  values (p_owner_staff_id, p_shop_id, p_owner_name, p_owner_phone, 'owner', p_owner_pin_hash,
    v_uid, p_device_id);
  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'shop.create', 'shops', p_shop_id,
    jsonb_build_object('name', p_name, 'type', p_type, 'owner_staff_id', p_owner_staff_id));
  return p_shop_id;
end;
$$;

drop function public.sync_scope_allows(text, text);
delete from public.sync_tables where table_name = 'staff_pins';
update public.sync_tables set push_columns = push_columns || array['pin_hash']
where table_name = 'staff';
alter table public.sync_tables drop column write_roles;
alter table public.sync_tables drop constraint sync_tables_pull_scope_check;
alter table public.sync_tables add constraint sync_tables_pull_scope_check
  check (pull_scope in ('all', 'owner_device'));

-- Hashes go back to staff.
update public.staff s set pin_hash = p.pin_hash from public.staff_pins p where p.staff_id = s.id;
drop table public.staff_pins;
