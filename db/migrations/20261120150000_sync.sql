-- migrate:up

-- Sync engine (architecture §4, docs/progress.md Step 5).
-- 1. devices.mode (owner | shop | rider) and register_device(..., p_mode). The mode decides what
--    a device may pull and push: a shop device runs on the owner's session, so RLS alone cannot
--    keep owner-only tables (staff_salaries, later product_costs) off it.
-- 2. sync_tables: the registry. sync_push and sync_pull only touch tables listed here, so a new
--    synced table is added by one insert into sync_tables (plus its entry in
--    packages/core/src/sync/tables.ts).
-- 3. sync_conflicts: last-write-wins losers, kept for review.
-- 4. is_day_closed(): stub until day_closes exists; that migration replaces it.
-- 5. sync_push / sync_pull and the device bookkeeping helper.

-- ---------------------------------------------------------------------------
-- devices.mode. Default 'shop' so a device never gets owner-only data by accident.
-- Only owners change it: register_device checks the role, and devices_update_owner (RLS) covers
-- direct updates.
-- ---------------------------------------------------------------------------
alter table public.devices
  add column mode text not null default 'shop' check (mode in ('owner', 'shop', 'rider'));

-- Sync bookkeeping (last_sync_at, last_seq_pulled) must not bump server_seq: every pull updates
-- them, so the device's own row would come back on every pull and paging would never end.
-- Any other change still gets a new server_seq, and a client-sent server_seq is still overwritten.
create function public.set_device_server_seq()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (to_jsonb(new) - array['last_sync_at', 'last_seq_pulled', 'server_seq'])
      = (to_jsonb(old) - array['last_sync_at', 'last_seq_pulled', 'server_seq']) then
    new.server_seq := old.server_seq;
  else
    new.server_seq := nextval('public.server_seq');
  end if;
  return new;
end;
$$;
revoke all on function public.set_device_server_seq() from public;

drop trigger set_server_seq on public.devices;
create trigger set_server_seq before insert or update on public.devices
  for each row execute function public.set_device_server_seq();

-- register_device gains p_mode. A retry returns the existing row unchanged (mode included).
drop function public.register_device(uuid, uuid, text);

create function public.register_device(
  p_device_id uuid,
  p_shop_id uuid,
  p_name text,
  p_mode text default 'shop'
)
returns public.devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
  v_existing public.devices;
  v_count integer;
  v_row public.devices;
begin
  if v_uid is null then
    raise exception 'register_device: not signed in' using errcode = '42501';
  end if;
  if not public.has_shop_role(p_shop_id, array['owner']) then
    raise exception 'register_device: only the shop owner can register devices'
      using errcode = '42501';
  end if;

  perform 1 from public.shops s where s.id = p_shop_id for update;

  select * into v_existing from public.devices d where d.id = p_device_id;
  if found then
    if v_existing.shop_id = p_shop_id then
      return v_existing; -- retry of a request that already succeeded
    end if;
    raise exception 'register_device: device id already in use' using errcode = '23505';
  end if;

  select count(*) into v_count from public.devices d where d.shop_id = p_shop_id;
  if v_count >= 26 * 999 then
    raise exception 'register_device: no device codes left' using errcode = '54000';
  end if;

  insert into public.devices (id, shop_id, name, code, registered_by, mode)
  values (p_device_id, p_shop_id, p_name,
    chr(65 + v_count / 999) || ((v_count % 999) + 1)::text, v_uid, p_mode)
  returning * into v_row;

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'device.register', 'devices', p_device_id,
    jsonb_build_object('name', p_name, 'code', v_row.code, 'mode', p_mode));

  return v_row;
end;
$$;

revoke all on function public.register_device(uuid, uuid, text, text) from public;
grant execute on function public.register_device(uuid, uuid, text, text) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- sync_tables: which tables sync and how. Read by sync_push / sync_pull (security invoker), so
-- naqdpos_app may read it; nobody but migrations writes it.
--   kind          append = ledger (insert once, never update); mutable = last write wins
--   id_column     primary key column (staff_salaries uses staff_id)
--   shop_column   tenant column (shops uses id)
--   pushable      devices may send rows for it
--   push_columns  the only columns a device may set; server-managed columns stay out
--   pull_scope    all = every device of the shop; owner_device = devices with mode 'owner' only
--                 (applies to push too)
-- ---------------------------------------------------------------------------
create table public.sync_tables (
  table_name text primary key,
  kind text not null check (kind in ('append', 'mutable')),
  id_column text not null default 'id',
  shop_column text not null default 'shop_id',
  pushable boolean not null default false,
  push_columns text[] not null default '{}',
  pull_scope text not null default 'all' check (pull_scope in ('all', 'owner_device'))
);
alter table public.sync_tables enable row level security;
revoke all on public.sync_tables from public;
grant select on public.sync_tables to naqdpos_app;
create policy sync_tables_select on public.sync_tables for select to naqdpos_app using (true);

insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope)
values
  -- Shops are created by create_shop, never pushed; owners push settings edits (column grants
  -- and shops_update_owner still apply).
  ('shops', 'mutable', 'id', 'id', true,
    array['id', 'name', 'type', 'address', 'phone', 'receipt_footer', 'logo_path', 'timezone',
      'cashier_expense_limit_paisa', 'updated_at'],
    'all'),
  -- membership_user_id is server-managed (invites), so devices cannot link staff to accounts.
  ('staff', 'mutable', 'id', 'shop_id', true,
    array['id', 'shop_id', 'name', 'phone', 'role', 'pin_hash', 'active', 'created_at',
      'updated_at', 'deleted_at', 'device_id'],
    'all'),
  ('staff_salaries', 'mutable', 'staff_id', 'shop_id', true,
    array['staff_id', 'shop_id', 'monthly_salary_paisa', 'created_at', 'updated_at',
      'deleted_at', 'device_id'],
    'owner_device'),
  -- Devices are registered through register_device; pull only.
  ('devices', 'mutable', 'id', 'shop_id', false, '{}', 'all');

-- ---------------------------------------------------------------------------
-- sync_conflicts: a pushed edit that lost to a newer server version (§4). Server keeps its row;
-- the device gets the server row back in the push response. Not synced, so a server id is fine.
-- ---------------------------------------------------------------------------
create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id),
  device_id uuid not null references public.devices (id),
  table_name text not null,
  row_id uuid not null,
  incoming jsonb not null,
  incoming_updated_at timestamptz not null,
  server_updated_at timestamptz not null,
  at timestamptz not null default now()
);
create index sync_conflicts_shop_id_at_idx on public.sync_conflicts (shop_id, at);
alter table public.sync_conflicts enable row level security;
revoke all on public.sync_conflicts from public;
grant select, insert on public.sync_conflicts to naqdpos_app;
create policy sync_conflicts_select_owner on public.sync_conflicts
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner']));
create policy sync_conflicts_insert_member on public.sync_conflicts
  for insert to naqdpos_app with check (public.is_shop_member(shop_id));

-- ---------------------------------------------------------------------------
-- is_day_closed: true once the shop's day is closed; no ledger row may then use that date.
-- Stub until day_closes exists (its migration replaces this function).
-- ---------------------------------------------------------------------------
create function public.is_day_closed(p_shop_id uuid, p_business_date date)
returns boolean
language sql
stable
as $$
  select false;
$$;
revoke all on function public.is_day_closed(uuid, date) from public;
grant execute on function public.is_day_closed(uuid, date) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- sync_mark_device: sync bookkeeping. security definer because devices_update_owner lets only
-- owners update devices, and a rider's own phone syncs too. Members of the device's shop only.
-- ---------------------------------------------------------------------------
create function public.sync_mark_device(p_device_id uuid, p_seq bigint default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.devices d
  set last_sync_at = now(),
      last_seq_pulled = greatest(d.last_seq_pulled, coalesce(p_seq, d.last_seq_pulled))
  where d.id = p_device_id
    and d.deleted_at is null
    and public.is_shop_member(d.shop_id);
$$;
revoke all on function public.sync_mark_device(uuid, bigint) from public;
grant execute on function public.sync_mark_device(uuid, bigint) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- sync_device: the device being synced, as the caller sees it (RLS: members only). 42501 when
-- nobody is signed in, the device is unknown or invisible (not a member), or it was removed.
-- ---------------------------------------------------------------------------
create function public.sync_device(p_device_id uuid)
returns public.devices
language plpgsql
stable
set search_path = ''
as $$
declare
  v_device public.devices;
begin
  if public.current_user_id() is null then
    raise exception 'sync: not signed in' using errcode = '42501';
  end if;
  select * into v_device from public.devices d where d.id = p_device_id and d.deleted_at is null;
  if not found then
    raise exception 'sync: device is not linked to a shop of this user' using errcode = '42501';
  end if;
  return v_device;
end;
$$;
revoke all on function public.sync_device(uuid) from public;
grant execute on function public.sync_device(uuid) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- sync_push(device_id, entries): applies one batch of outbox entries (§4).
-- entries: [{ id: <outbox entry id>, table, op, row }]
-- returns: { accepted: [entry id], conflicts: [{ id, table, row }], errors: [{ id, code, message }] }
--
-- security invoker: every write goes through RLS and column grants as the signed-in user.
-- Each entry runs in its own sub-transaction, so one bad entry never fails the batch.
-- Error codes: unknown_table, not_pushable, forbidden, other_shop, clock_ahead, day_closed,
-- invalid. Conflicts are not errors: the entry is done and the device takes the server row.
-- ---------------------------------------------------------------------------
create function public.sync_push(p_device_id uuid, p_entries jsonb)
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
revoke all on function public.sync_push(uuid, jsonb) from public;
grant execute on function public.sync_push(uuid, jsonb) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- sync_pull(device_id, since_seq, limit): rows of the device's shop with server_seq > since_seq,
-- ordered by server_seq (§4). RLS limits rows to what the user may see; owner_device tables are
-- skipped unless the device's mode is 'owner'.
-- returns: { rows: [{ table, row, server_seq }], next_seq, has_more }
-- ---------------------------------------------------------------------------
create function public.sync_pull(p_device_id uuid, p_since_seq bigint, p_limit integer)
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
revoke all on function public.sync_pull(uuid, bigint, integer) from public;
grant execute on function public.sync_pull(uuid, bigint, integer) to naqdpos_app;

-- migrate:down

drop function public.sync_pull(uuid, bigint, integer);
drop function public.sync_push(uuid, jsonb);
drop function public.sync_device(uuid);
drop function public.sync_mark_device(uuid, bigint);
drop function public.is_day_closed(uuid, date);
drop table public.sync_conflicts;
drop table public.sync_tables;

drop function public.register_device(uuid, uuid, text, text);
create function public.register_device(p_device_id uuid, p_shop_id uuid, p_name text)
returns public.devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
  v_existing public.devices;
  v_count integer;
  v_row public.devices;
begin
  if v_uid is null then
    raise exception 'register_device: not signed in' using errcode = '42501';
  end if;
  if not public.has_shop_role(p_shop_id, array['owner']) then
    raise exception 'register_device: only the shop owner can register devices'
      using errcode = '42501';
  end if;
  perform 1 from public.shops s where s.id = p_shop_id for update;
  select * into v_existing from public.devices d where d.id = p_device_id;
  if found then
    if v_existing.shop_id = p_shop_id then
      return v_existing;
    end if;
    raise exception 'register_device: device id already in use' using errcode = '23505';
  end if;
  select count(*) into v_count from public.devices d where d.shop_id = p_shop_id;
  if v_count >= 26 * 999 then
    raise exception 'register_device: no device codes left' using errcode = '54000';
  end if;
  insert into public.devices (id, shop_id, name, code, registered_by)
  values (p_device_id, p_shop_id, p_name,
    chr(65 + v_count / 999) || ((v_count % 999) + 1)::text, v_uid)
  returning * into v_row;
  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'device.register', 'devices', p_device_id,
    jsonb_build_object('name', p_name, 'code', v_row.code));
  return v_row;
end;
$$;
revoke all on function public.register_device(uuid, uuid, text) from public;
grant execute on function public.register_device(uuid, uuid, text) to naqdpos_app;

drop trigger set_server_seq on public.devices;
create trigger set_server_seq before insert or update on public.devices
  for each row execute function public.set_server_seq();
drop function public.set_device_server_seq();
alter table public.devices drop column mode;
