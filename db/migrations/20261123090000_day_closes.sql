-- migrate:up
-- Daily closing (US044, US045, US067; architecture §3 day_closes, §4, §7).
-- 1. day_closes: append-only (a close is final), one per shop and business date, only by an owner
--    (trigger on the acting staff member), never for a future date. seen_through_seq (approved
--    22 Nov 2026) = the closing device's pull cursor when it closed: a row of that date with a
--    higher server_seq was not seen at closing, unless the closing device made it itself before
--    closed_at (it counted those from its own Dexie).
-- 2. Late rows are accepted: sync_push no longer rejects ledger rows for a closed date
--    ('day_closed' stays a reserved code). Devices that know the day is closed date new rows to
--    the next open day.
-- 3. is_day_closed() becomes the real lookup; shop_expected_cash() matches expectedCash() in core.

create table public.day_closes (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  business_date date not null,
  opening_cash_paisa bigint not null check (opening_cash_paisa >= 0),
  expected_cash_paisa bigint not null,
  counted_cash_paisa bigint not null check (counted_cash_paisa >= 0),
  difference_paisa bigint not null,
  owner_withdrawal_paisa bigint not null default 0 check (owner_withdrawal_paisa >= 0),
  note text check (note is null or length(note) <= 500),
  closed_by_staff_id uuid not null,
  closed_at timestamptz not null,
  seen_through_seq bigint not null check (seen_through_seq >= 0),
  device_id uuid,
  server_seq bigint not null,
  constraint day_closes_difference check (difference_paisa = counted_cash_paisa - expected_cash_paisa),
  unique (shop_id, business_date),
  foreign key (closed_by_staff_id, shop_id) references public.staff (id, shop_id)
);
create index day_closes_server_seq_idx on public.day_closes (server_seq);
alter table public.day_closes enable row level security;
create trigger set_server_seq before insert or update on public.day_closes
  for each row execute function public.set_server_seq();

revoke all on public.day_closes from public;
grant select, insert on public.day_closes to naqdpos_app; -- append-only
create policy day_closes_select_seller on public.day_closes
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy day_closes_insert_owner on public.day_closes
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));

create function public.day_closes_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_staff_id', true), '')::uuid;
  v_today date;
begin
  if v_actor is not null and not exists (
      select 1 from public.staff s
      where s.id = v_actor and s.shop_id = new.shop_id and s.role = 'owner'
        and s.active and s.deleted_at is null) then
    raise exception 'day_closes: only an owner closes a day' using errcode = 'insufficient_privilege';
  end if;
  if new.closed_by_staff_id is distinct from coalesce(v_actor, new.closed_by_staff_id) then
    raise exception 'day_closes: closed_by must be the acting owner' using errcode = 'check_violation';
  end if;
  select (now() at time zone s.timezone)::date into v_today from public.shops s where s.id = new.shop_id;
  if new.business_date > v_today then
    raise exception 'day_closes: a future day cannot be closed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.day_closes_check() from public;
create trigger day_closes_check before insert on public.day_closes
  for each row execute function public.day_closes_check();

-- The real lookup (replaces the stub from 20261120150000_sync).
create or replace function public.is_day_closed(p_shop_id uuid, p_business_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.day_closes d
    where d.shop_id = p_shop_id and d.business_date = p_business_date);
$$;

-- Expected cash for a day (same formula as expectedCash() in packages/core):
-- opening + cash sale payments + cash khata receipts + rider handovers
-- − cash expenses (net of reversals) − cash refunds − cash supplier payments − owner withdrawal.
create function public.shop_expected_cash(
  p_shop_id uuid,
  p_business_date date,
  p_opening_paisa bigint,
  p_withdrawal_paisa bigint
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select p_opening_paisa
    + coalesce((
        select sum(case when p.kind in ('sale', 'khata_receipt', 'rider_handover') then p.amount_paisa
                        else -p.amount_paisa end)
        from public.payments p
        where p.shop_id = p_shop_id and p.business_date = p_business_date
          and p.method_code = 'cash'), 0)
    - coalesce((
        select sum(e.amount_paisa) from public.expenses e
        where e.shop_id = p_shop_id and e.business_date = p_business_date
          and e.paid_method_code = 'cash'), 0)
    - p_withdrawal_paisa;
$$;
revoke all on function public.shop_expected_cash(uuid, date, bigint, bigint) from public;
grant execute on function public.shop_expected_cash(uuid, date, bigint, bigint) to naqdpos_app;

insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope, write_roles)
values
  ('day_closes', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'business_date', 'opening_cash_paisa', 'expected_cash_paisa',
      'counted_cash_paisa', 'difference_paisa', 'owner_withdrawal_paisa', 'note',
      'closed_by_staff_id', 'closed_at', 'seen_through_seq', 'device_id'],
    'all', array['owner']);

-- ---------------------------------------------------------------------------
-- sync_push: as in 20261122090000_stock, without the day_closed rejection (late rows accepted).
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

create or replace function public.is_day_closed(p_shop_id uuid, p_business_date date)
returns boolean
language sql
stable
as $$
  select false;
$$;
delete from public.sync_tables where table_name = 'day_closes';
drop function public.shop_expected_cash(uuid, date, bigint, bigint);
drop table public.day_closes;
drop function public.day_closes_check();
