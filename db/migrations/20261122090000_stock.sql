-- migrate:up
-- Stock (US024, US025; architecture §3 stock_movements, derived values).
-- 1. stock_movements: append-only ledger, NO cost column (every device pulls it; cost would
--    reach cashiers). Stock of a product = sum(qty_milli). Riders read none.
-- 2. Per-reason rules in a trigger: 'sale' needs ref_id = a sale of the shop (else a
--    foreign-key error, retried by the device as missing_parent); 'purchase' and
--    'count_correction' only by an owner: the acting staff member in sync_push
--    (app.actor_staff_id), or the signed-in user for a direct insert.
-- 3. product_stock view (security_invoker, so RLS applies) for reports.
-- 4. sync_push sets app.actor_staff_id per entry so table triggers can check the actor.

create table public.stock_movements (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  product_id uuid not null,
  business_date date not null,
  qty_milli bigint not null check (qty_milli <> 0),
  reason text not null check (reason in
    ('sale', 'return', 'purchase', 'wastage', 'damaged', 'count_correction', 'combo_component')),
  ref_id uuid,
  note text check (note is null or length(note) <= 200),
  staff_id uuid not null,
  device_id uuid,
  created_at timestamptz not null,
  server_seq bigint not null,
  check (reason <> 'sale' or ref_id is not null),
  foreign key (product_id, shop_id) references public.products (id, shop_id),
  foreign key (staff_id, shop_id) references public.staff (id, shop_id)
);
create index stock_movements_shop_product_idx on public.stock_movements (shop_id, product_id);
create index stock_movements_shop_date_idx on public.stock_movements (shop_id, business_date);
create index stock_movements_server_seq_idx on public.stock_movements (server_seq);
alter table public.stock_movements enable row level security;

create trigger set_server_seq before insert or update on public.stock_movements
  for each row execute function public.set_server_seq();

revoke all on public.stock_movements from public;
grant select, insert on public.stock_movements to naqdpos_app; -- append-only

create policy stock_movements_select_seller on public.stock_movements
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy stock_movements_insert_seller on public.stock_movements
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner', 'cashier']));

create function public.stock_movements_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_staff_id', true), '')::uuid;
begin
  -- A missing ref_id is left to the check constraint (a bad row, not a missing parent).
  if new.reason = 'sale' and new.ref_id is not null and not exists (
      select 1 from public.sales s where s.id = new.ref_id and s.shop_id = new.shop_id) then
    raise exception 'stock movement: sale % not found', new.ref_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.reason in ('purchase', 'count_correction') then
    if v_actor is not null then
      if not exists (
          select 1 from public.staff s
          where s.id = v_actor and s.shop_id = new.shop_id and s.role = 'owner'
            and s.active and s.deleted_at is null) then
        raise exception 'stock movement: % is for owners only', new.reason
          using errcode = 'insufficient_privilege';
      end if;
    elsif not public.has_shop_role(new.shop_id, array['owner']) then
      raise exception 'stock movement: % is for owners only', new.reason
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stock_movements_check() from public;

create trigger stock_movements_check before insert on public.stock_movements
  for each row execute function public.stock_movements_check();

-- Stock on hand per product (same rule as stockByProduct() in packages/core).
create view public.product_stock
with (security_invoker = true) as
  select m.shop_id, m.product_id, sum(m.qty_milli)::bigint as qty_milli
  from public.stock_movements m
  group by m.shop_id, m.product_id;
revoke all on public.product_stock from public;
grant select on public.product_stock to naqdpos_app;

insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope, write_roles)
values
  ('stock_movements', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'product_id', 'business_date', 'qty_milli', 'reason', 'ref_id', 'note',
      'staff_id', 'created_at', 'device_id'],
    'all', array['owner', 'cashier']);

-- ---------------------------------------------------------------------------
-- sync_push: as in 20261121210000_sales, plus app.actor_staff_id for table triggers.
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

  perform public.sync_mark_device(p_device_id);

  return jsonb_build_object('accepted', v_accepted, 'conflicts', v_conflicts, 'errors', v_errors);
end;
$$;
revoke all on function public.sync_push(uuid, jsonb) from public;
grant execute on function public.sync_push(uuid, jsonb) to naqdpos_app;

delete from public.sync_tables where table_name = 'stock_movements';
drop view public.product_stock;
drop table public.stock_movements;
drop function public.stock_movements_check();
