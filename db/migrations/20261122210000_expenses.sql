-- migrate:up
-- Expenses (US065, US046, US066; docs/features/expense-management.md EXP-1..3).
-- 1. expense_categories: mutable, owner-only writes; defaults seeded per shop type with i18n
--    keys (no "Wastage": wastage is a stock movement, valued in reports from cost history).
--    name_ur (approved 22 Nov 2026) holds an owner-typed Urdu name.
-- 2. expenses: append-only. A wrong expense is fixed by a reversal row (negative amount,
--    reverses_expense_id unique, reason), only by an owner (trigger, like stock / khata).
-- 3. shops.cashier_expense_limit_paisa already exists (foundation migration).

create table public.expense_categories (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  name text not null check (length(trim(name)) between 1 and 40),
  name_ur text check (name_ur is null or length(trim(name_ur)) between 1 and 40),
  i18n_key text check (i18n_key is null or i18n_key ~ '^expense\.cat\.[a-z_]{1,32}$'),
  icon text check (icon is null or char_length(icon) <= 16),
  sort integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  unique (id, shop_id)
);
create index expense_categories_shop_idx on public.expense_categories (shop_id);
create index expense_categories_server_seq_idx on public.expense_categories (server_seq);
alter table public.expense_categories enable row level security;
create trigger set_server_seq before insert or update on public.expense_categories
  for each row execute function public.set_server_seq();

revoke all on public.expense_categories from public;
grant select, insert, update on public.expense_categories to naqdpos_app;
create policy expense_categories_select_seller on public.expense_categories
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy expense_categories_insert_owner on public.expense_categories
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));
create policy expense_categories_update_owner on public.expense_categories
  for update to naqdpos_app
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

-- Defaults by shop type (same list as EXPENSE_CATEGORY_DEFAULTS in packages/core).
create function public.seed_expense_categories(p_shop_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.expense_categories (id, shop_id, name, i18n_key, sort)
  select gen_random_uuid(), s.id, d.name, 'expense.cat.' || d.key, d.sort
  from public.shops s
  cross join (values
    ('mandi_transport', 'Mandi transport', 1, true),
    ('rent', 'Rent', 2, false),
    ('bijli_gas', 'Bijli/gas', 3, false),
    ('staff_salary', 'Staff salary', 4, false),
    ('staff_advance', 'Staff advance', 5, false),
    ('petrol', 'Petrol', 6, false),
    ('shopping_bags', 'Shopping bags', 7, false),
    ('other', 'Other', 8, false)
  ) as d(key, name, sort, fruit_veg_only)
  where s.id = p_shop_id
    and (not d.fruit_veg_only or s.type = 'fruit_veg')
    and not exists (
      select 1 from public.expense_categories c
      where c.shop_id = s.id and c.i18n_key = 'expense.cat.' || d.key);
$$;
revoke all on function public.seed_expense_categories(uuid) from public;
select public.seed_expense_categories(s.id) from public.shops s;

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  business_date date not null,
  category_id uuid not null,
  amount_paisa bigint not null check (amount_paisa <> 0),
  paid_method_code text not null,
  note text check (note is null or length(note) <= 200),
  payee text check (payee is null or length(payee) <= 60),
  payee_staff_id uuid,
  staff_id uuid not null,
  approved_by_staff_id uuid,
  reverses_expense_id uuid unique,
  reversal_reason text check (reversal_reason is null or length(trim(reversal_reason)) between 1 and 200),
  recurring_expense_id uuid, -- FK with recurring_expenses (Release 2)
  created_at timestamptz not null,
  device_id uuid,
  server_seq bigint not null,
  constraint expenses_amount_sign check (
    (reverses_expense_id is null and amount_paisa > 0 and reversal_reason is null)
    or (reverses_expense_id is not null and amount_paisa < 0 and reversal_reason is not null)),
  unique (id, shop_id),
  foreign key (category_id, shop_id) references public.expense_categories (id, shop_id),
  foreign key (shop_id, paid_method_code) references public.payment_methods (shop_id, code),
  foreign key (staff_id, shop_id) references public.staff (id, shop_id),
  foreign key (approved_by_staff_id, shop_id) references public.staff (id, shop_id),
  foreign key (payee_staff_id, shop_id) references public.staff (id, shop_id),
  foreign key (reverses_expense_id, shop_id) references public.expenses (id, shop_id)
);
create index expenses_shop_date_idx on public.expenses (shop_id, business_date);
create index expenses_server_seq_idx on public.expenses (server_seq);
alter table public.expenses enable row level security;
create trigger set_server_seq before insert or update on public.expenses
  for each row execute function public.set_server_seq();

revoke all on public.expenses from public;
grant select, insert on public.expenses to naqdpos_app; -- append-only
create policy expenses_select_seller on public.expenses
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy expenses_insert_seller on public.expenses
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner', 'cashier']));

-- Reversals: owner only; the original exists in the shop, is not itself a reversal, and the
-- amount is exactly −original. The approver, when set, is an owner.
create function public.expenses_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_staff_id', true), '')::uuid;
  v_original public.expenses;
  v_is_owner boolean;
begin
  if new.approved_by_staff_id is not null and not exists (
      select 1 from public.staff s
      where s.id = new.approved_by_staff_id and s.shop_id = new.shop_id and s.role = 'owner') then
    raise exception 'expenses: the approver must be an owner' using errcode = 'check_violation';
  end if;

  if new.reverses_expense_id is not null then
    if v_actor is not null then
      v_is_owner := exists (
        select 1 from public.staff s
        where s.id = v_actor and s.shop_id = new.shop_id and s.role = 'owner'
          and s.active and s.deleted_at is null);
    else
      v_is_owner := public.has_shop_role(new.shop_id, array['owner']);
    end if;
    if not v_is_owner then
      raise exception 'expenses: only an owner may reverse an expense'
        using errcode = 'insufficient_privilege';
    end if;
    select * into v_original from public.expenses e
    where e.id = new.reverses_expense_id and e.shop_id = new.shop_id;
    if not found then
      raise exception 'expenses: original % not found', new.reverses_expense_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_original.reverses_expense_id is not null then
      raise exception 'expenses: a reversal cannot be reversed' using errcode = 'check_violation';
    end if;
    if new.amount_paisa <> -v_original.amount_paisa then
      raise exception 'expenses: a reversal must be the negative of the original'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.expenses_check() from public;
create trigger expenses_check before insert on public.expenses
  for each row execute function public.expenses_check();

insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope, write_roles)
values
  ('expense_categories', 'mutable', 'id', 'shop_id', true,
    array['id', 'shop_id', 'name', 'name_ur', 'i18n_key', 'icon', 'sort', 'archived_at',
      'created_at', 'updated_at', 'deleted_at', 'device_id'],
    'all', array['owner']),
  -- pull_scope all for now: "shop devices pull only open business dates" comes with day_closes.
  ('expenses', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'business_date', 'category_id', 'amount_paisa', 'paid_method_code',
      'note', 'payee', 'payee_staff_id', 'staff_id', 'approved_by_staff_id',
      'reverses_expense_id', 'reversal_reason', 'recurring_expense_id', 'created_at', 'device_id'],
    'all', array['owner', 'cashier']);

-- create_shop: as in 20261121210000_sales, plus the default expense categories.
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
  perform public.seed_expense_categories(p_shop_id);

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'shop.create', 'shops', p_shop_id,
    jsonb_build_object('name', p_name, 'type', p_type, 'owner_staff_id', p_owner_staff_id));

  return p_shop_id;
end;
$$;

-- migrate:down
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

delete from public.sync_tables where table_name in ('expenses', 'expense_categories');
drop table public.expenses;
drop function public.expenses_check();
drop function public.seed_expense_categories(uuid);
drop table public.expense_categories;
