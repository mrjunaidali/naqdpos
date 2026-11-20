-- migrate:up

-- Payment and completed sales (US034, US035; architecture §3; docs/progress.md Step 12).
-- 1. payment_methods (mutable, owner-only writes; cash always on), seeded for every shop and by
--    create_shop.
-- 2. sales, sale_lines, payments: append-only ledgers (CLAUDE.md rule 4). Owners and cashiers
--    read and write; riders do not (rider stories later). No update or delete privilege.
--    sales.rounding_paisa: the bill is rounded to the nearest whole rupee, half up
--    (total = subtotal − discount + rounding). sale_lines keeps name_ur_snapshot and by_amount.
-- 3. sync_push: a foreign-key violation (a line pushed before its sale, a sale using a product not
--    there yet) returns 'missing_parent', which the device retries instead of giving up.

-- ---------------------------------------------------------------------------
-- payment_methods
-- ---------------------------------------------------------------------------
create table public.payment_methods (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  code text not null check (code ~ '^[a-z0-9_]{1,32}$'),
  label text not null check (length(trim(label)) between 1 and 40),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  unique (shop_id, code), -- target for payments' composite FK
  -- cash can never be switched off or removed
  check (code <> 'cash' or (active and deleted_at is null))
);
create index payment_methods_shop_id_idx on public.payment_methods (shop_id);
create index payment_methods_server_seq_idx on public.payment_methods (server_seq);
alter table public.payment_methods enable row level security;

-- ---------------------------------------------------------------------------
-- sales, sale_lines, payments
-- ---------------------------------------------------------------------------
create table public.sales (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  receipt_no text not null check (receipt_no ~ '^[A-Z][0-9]{1,3}-[0-9]{6,}$'),
  business_date date not null,
  staff_id uuid not null,
  customer_id uuid, -- FK added with the customers table (khata)
  order_type text not null default 'walk_in' check (order_type in ('walk_in', 'delivery')),
  source text not null default 'walk_in' check (source ~ '^[a-z_]{1,32}$'),
  subtotal_paisa bigint not null check (subtotal_paisa >= 0),
  discount_paisa bigint not null default 0 check (discount_paisa >= 0),
  rounding_paisa bigint not null default 0 check (rounding_paisa between -50 and 50),
  total_paisa bigint not null check (total_paisa >= 0),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null,
  device_id uuid,
  server_seq bigint not null,
  check (total_paisa = subtotal_paisa - discount_paisa + rounding_paisa),
  unique (shop_id, receipt_no),
  unique (id, shop_id),
  foreign key (staff_id, shop_id) references public.staff (id, shop_id)
);
create index sales_shop_date_idx on public.sales (shop_id, business_date);
create index sales_server_seq_idx on public.sales (server_seq);
alter table public.sales enable row level security;

create table public.sale_lines (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  sale_id uuid not null,
  product_id uuid, -- null = custom item
  name_snapshot text not null check (length(trim(name_snapshot)) between 1 and 100),
  name_ur_snapshot text check (name_ur_snapshot is null or length(name_ur_snapshot) <= 100),
  unit_snapshot text not null check (unit_snapshot in ('kg', 'g', 'dozen', 'piece', 'bundle', 'litre')),
  qty_milli bigint not null check (qty_milli > 0),
  unit_price_paisa bigint not null check (unit_price_paisa >= 0),
  discount_paisa bigint not null default 0 check (discount_paisa >= 0),
  is_foc boolean not null default false,
  by_amount boolean not null default false,
  line_total_paisa bigint not null check (line_total_paisa >= 0),
  created_at timestamptz not null,
  device_id uuid,
  server_seq bigint not null,
  foreign key (sale_id, shop_id) references public.sales (id, shop_id),
  foreign key (product_id, shop_id) references public.products (id, shop_id)
);
create index sale_lines_sale_id_idx on public.sale_lines (sale_id);
create index sale_lines_server_seq_idx on public.sale_lines (server_seq);
alter table public.sale_lines enable row level security;

create table public.payments (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  business_date date not null,
  kind text not null
    check (kind in ('sale', 'khata_receipt', 'refund', 'supplier_payment', 'rider_handover')),
  sale_id uuid,
  customer_id uuid, -- FK added with the customers table (khata)
  method_code text not null,
  amount_paisa bigint not null check (amount_paisa > 0),
  reference text check (reference is null or length(reference) <= 64),
  staff_id uuid not null,
  created_at timestamptz not null,
  device_id uuid,
  server_seq bigint not null,
  check (kind <> 'sale' or sale_id is not null),
  foreign key (sale_id, shop_id) references public.sales (id, shop_id),
  foreign key (shop_id, method_code) references public.payment_methods (shop_id, code),
  foreign key (staff_id, shop_id) references public.staff (id, shop_id)
);
create index payments_shop_date_idx on public.payments (shop_id, business_date);
create index payments_sale_id_idx on public.payments (sale_id);
create index payments_server_seq_idx on public.payments (server_seq);
alter table public.payments enable row level security;

create trigger set_server_seq before insert or update on public.payment_methods
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.sales
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.sale_lines
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.payments
  for each row execute function public.set_server_seq();

revoke all on public.payment_methods, public.sales, public.sale_lines, public.payments from public;
grant select, insert, update on public.payment_methods to naqdpos_app;
-- Ledgers: insert and read only (append-only).
grant select, insert on public.sales, public.sale_lines, public.payments to naqdpos_app;

create policy payment_methods_select_member on public.payment_methods
  for select to naqdpos_app using (public.is_shop_member(shop_id));
create policy payment_methods_insert_owner on public.payment_methods
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));
create policy payment_methods_update_owner on public.payment_methods
  for update to naqdpos_app
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

create policy sales_select_seller on public.sales
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy sales_insert_seller on public.sales
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy sale_lines_select_seller on public.sale_lines
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy sale_lines_insert_seller on public.sale_lines
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy payments_select_seller on public.payments
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy payments_insert_seller on public.payments
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner', 'cashier']));

-- ---------------------------------------------------------------------------
-- Seed the four payment methods: every existing shop now, every new shop in create_shop.
-- ---------------------------------------------------------------------------
create function public.seed_payment_methods(p_shop_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.payment_methods (id, shop_id, code, label, sort)
  values
    (gen_random_uuid(), p_shop_id, 'cash', 'Cash', 1),
    (gen_random_uuid(), p_shop_id, 'jazzcash', 'JazzCash', 2),
    (gen_random_uuid(), p_shop_id, 'easypaisa', 'Easypaisa', 3),
    (gen_random_uuid(), p_shop_id, 'bank', 'Bank transfer', 4)
  on conflict (shop_id, code) do nothing;
$$;
revoke all on function public.seed_payment_methods(uuid) from public;

select public.seed_payment_methods(s.id) from public.shops s;

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

  perform public.seed_payment_methods(p_shop_id);

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'shop.create', 'shops', p_shop_id,
    jsonb_build_object('name', p_name, 'type', p_type, 'owner_staff_id', p_owner_staff_id));

  return p_shop_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sync registry
-- ---------------------------------------------------------------------------
insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope, write_roles)
values
  ('payment_methods', 'mutable', 'id', 'shop_id', true,
    array['id', 'shop_id', 'code', 'label', 'active', 'sort', 'created_at', 'updated_at',
      'deleted_at', 'device_id'],
    'all', array['owner']),
  ('sales', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'receipt_no', 'business_date', 'staff_id', 'customer_id', 'order_type',
      'source', 'subtotal_paisa', 'discount_paisa', 'rounding_paisa', 'total_paisa', 'note',
      'created_at', 'device_id'],
    'all', array['owner', 'cashier']),
  ('sale_lines', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'sale_id', 'product_id', 'name_snapshot', 'name_ur_snapshot',
      'unit_snapshot', 'qty_milli', 'unit_price_paisa', 'discount_paisa', 'is_foc', 'by_amount',
      'line_total_paisa', 'created_at', 'device_id'],
    'all', array['owner', 'cashier']),
  ('payments', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'business_date', 'kind', 'sale_id', 'customer_id', 'method_code',
      'amount_paisa', 'reference', 'staff_id', 'created_at', 'device_id'],
    'all', array['owner', 'cashier']);

-- ---------------------------------------------------------------------------
-- sync_push: as in 20261120170000_staff_pins, plus 'missing_parent' for foreign-key violations.
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

delete from public.sync_tables where table_name in ('payment_methods', 'sales', 'sale_lines', 'payments');

-- create_shop without payment methods (as in 20261120170000_staff_pins).
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

drop function public.seed_payment_methods(uuid);
drop table public.payments, public.sale_lines, public.sales, public.payment_methods;
