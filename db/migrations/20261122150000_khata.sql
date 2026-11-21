-- migrate:up
-- Customers and khata (US038–US041; architecture §3, §4).
-- 1. customers: mutable (last write wins). The id is UUIDv5(shop_id, E.164 mobile), made on the
--    device, so two devices adding the same mobile offline produce the same row and sync merges
--    it. The mobile never changes after creation (a new number = a new customer); unique
--    (shop_id, mobile) stays as a safety net.
-- 2. khata_entries: append-only; balance = sum(amount_paisa), positive = the customer owes more.
--    Per type: credit_sale needs its sale and is positive; payment needs its payment and is
--    negative; adjustment needs a note and only an owner may record it (trigger, like stock).
-- 3. sales.customer_id and payments.customer_id now reference the shop's customers; a
--    khata_receipt payment needs a customer.

create table public.customers (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  mobile text not null check (mobile ~ '^\+923[0-9]{9}$'),
  name text check (name is null or length(trim(name)) between 1 and 60),
  address text check (address is null or length(address) <= 200),
  credit_limit_paisa bigint check (credit_limit_paisa is null or credit_limit_paisa >= 0),
  whatsapp_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  unique (shop_id, mobile),
  unique (id, shop_id)
);
create index customers_server_seq_idx on public.customers (server_seq);
alter table public.customers enable row level security;

create trigger set_server_seq before insert or update on public.customers
  for each row execute function public.set_server_seq();

create function public.customers_mobile_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mobile is distinct from old.mobile then
    raise exception 'customers: the mobile number cannot change (add a new customer)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.customers_mobile_fixed() from public;
create trigger customers_mobile_fixed before update on public.customers
  for each row execute function public.customers_mobile_fixed();

revoke all on public.customers from public;
grant select, insert, update on public.customers to naqdpos_app;
create policy customers_select_seller on public.customers
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy customers_insert_seller on public.customers
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy customers_update_seller on public.customers
  for update to naqdpos_app
  using (public.has_shop_role(shop_id, array['owner', 'cashier']))
  with check (public.has_shop_role(shop_id, array['owner', 'cashier']));

-- ---------------------------------------------------------------------------
-- sales / payments → customers
-- ---------------------------------------------------------------------------
alter table public.sales
  add constraint sales_customer_fk foreign key (customer_id, shop_id)
    references public.customers (id, shop_id);
alter table public.payments
  add constraint payments_customer_fk foreign key (customer_id, shop_id)
    references public.customers (id, shop_id),
  add constraint payments_khata_receipt_customer
    check (kind <> 'khata_receipt' or customer_id is not null),
  add constraint payments_id_shop_key unique (id, shop_id);

-- ---------------------------------------------------------------------------
-- khata_entries
-- ---------------------------------------------------------------------------
create table public.khata_entries (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  customer_id uuid not null,
  business_date date not null,
  type text not null check (type in ('credit_sale', 'payment', 'return_credit', 'adjustment')),
  amount_paisa bigint not null check (amount_paisa <> 0),
  sale_id uuid,
  payment_id uuid,
  note text check (note is null or length(note) <= 200),
  staff_id uuid not null,
  device_id uuid,
  created_at timestamptz not null,
  server_seq bigint not null,
  constraint khata_entries_credit_sale
    check (type <> 'credit_sale' or (sale_id is not null and amount_paisa > 0)),
  constraint khata_entries_payment
    check (type <> 'payment' or (payment_id is not null and amount_paisa < 0)),
  constraint khata_entries_adjustment
    check (type <> 'adjustment' or (note is not null and length(trim(note)) > 0)),
  constraint khata_entries_return_credit check (type <> 'return_credit' or amount_paisa < 0),
  foreign key (customer_id, shop_id) references public.customers (id, shop_id),
  foreign key (sale_id, shop_id) references public.sales (id, shop_id),
  foreign key (payment_id, shop_id) references public.payments (id, shop_id),
  foreign key (staff_id, shop_id) references public.staff (id, shop_id)
);
create index khata_entries_shop_customer_idx on public.khata_entries (shop_id, customer_id);
create index khata_entries_shop_date_idx on public.khata_entries (shop_id, business_date);
create index khata_entries_server_seq_idx on public.khata_entries (server_seq);
alter table public.khata_entries enable row level security;

create trigger set_server_seq before insert or update on public.khata_entries
  for each row execute function public.set_server_seq();

revoke all on public.khata_entries from public;
grant select, insert on public.khata_entries to naqdpos_app; -- append-only
create policy khata_entries_select_seller on public.khata_entries
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner', 'cashier']));
create policy khata_entries_insert_seller on public.khata_entries
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner', 'cashier']));

-- adjustment: owners only (the acting staff member in sync_push, else the signed-in user).
create function public.khata_entries_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_staff_id', true), '')::uuid;
begin
  if new.type = 'adjustment' then
    if v_actor is not null then
      if not exists (
          select 1 from public.staff s
          where s.id = v_actor and s.shop_id = new.shop_id and s.role = 'owner'
            and s.active and s.deleted_at is null) then
        raise exception 'khata: adjustments are for owners only'
          using errcode = 'insufficient_privilege';
      end if;
    elsif not public.has_shop_role(new.shop_id, array['owner']) then
      raise exception 'khata: adjustments are for owners only'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.khata_entries_check() from public;
create trigger khata_entries_check before insert on public.khata_entries
  for each row execute function public.khata_entries_check();

-- Balances for reports (same rule as khataBalance() in packages/core); RLS applies.
create view public.customer_balances
with (security_invoker = true) as
  select k.shop_id, k.customer_id,
    sum(k.amount_paisa)::bigint as balance_paisa,
    max(k.business_date) filter (where k.type = 'payment') as last_payment_date,
    min(k.business_date) as first_entry_date
  from public.khata_entries k
  group by k.shop_id, k.customer_id;
revoke all on public.customer_balances from public;
grant select on public.customer_balances to naqdpos_app;

insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope, write_roles)
values
  ('customers', 'mutable', 'id', 'shop_id', true,
    array['id', 'shop_id', 'mobile', 'name', 'address', 'credit_limit_paisa', 'whatsapp_opt_in',
      'created_at', 'updated_at', 'deleted_at', 'device_id'],
    'all', array['owner', 'cashier']),
  ('khata_entries', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'customer_id', 'business_date', 'type', 'amount_paisa', 'sale_id',
      'payment_id', 'note', 'staff_id', 'created_at', 'device_id'],
    'all', array['owner', 'cashier']);

-- migrate:down
delete from public.sync_tables where table_name in ('customers', 'khata_entries');
drop view public.customer_balances;
drop table public.khata_entries;
drop function public.khata_entries_check();
alter table public.payments
  drop constraint payments_id_shop_key,
  drop constraint payments_khata_receipt_customer,
  drop constraint payments_customer_fk;
alter table public.sales drop constraint sales_customer_fk;
drop table public.customers;
drop function public.customers_mobile_fixed();
