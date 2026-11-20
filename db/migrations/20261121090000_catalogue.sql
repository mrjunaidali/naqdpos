-- migrate:up

-- Catalogue (architecture §3; docs/progress.md Step 7): categories, products, product_costs,
-- price_history and product_cost_history.
-- - Costs are owner-only: product_costs (current cost) and product_cost_history are read and
--   written by owners only, and only owner devices pull or push them (pull_scope owner_device).
--   price_history keeps sale prices only, so cost history never reaches shop devices (decided
--   20 Nov 2026).
-- - products.search_terms keeps other names and Roman Urdu spellings (aalu, pyaz…) so the sale
--   screen finds them offline (decided 20 Nov 2026).
-- - Changing products and prices is owner-only (can(role, 'manage_products')): RLS here and
--   write_roles {owner} in sync_tables.
-- - price_history and product_cost_history are append-only ledgers (CLAUDE.md rule 4).

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  name text not null check (length(trim(name)) between 1 and 60),
  name_ur text check (name_ur is null or length(name_ur) <= 60),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  unique (id, shop_id) -- target for products' composite FK
);
create index categories_shop_id_idx on public.categories (shop_id);
create index categories_server_seq_idx on public.categories (server_seq);
alter table public.categories enable row level security;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
-- search_terms: at most 20 terms of 1–40 characters. A function, because a check constraint
-- cannot hold a subquery.
create function public.search_terms_ok(p_terms text[])
returns boolean
language sql
immutable
as $$
  select coalesce(cardinality(p_terms), 0) <= 20
    and coalesce((select bool_and(length(t) between 1 and 40) from unnest(p_terms) t), true);
$$;
revoke all on function public.search_terms_ok(text[]) from public;
-- The check constraint runs as the inserting role, so the app role needs it.
grant execute on function public.search_terms_ok(text[]) to naqdpos_app;

create table public.products (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  category_id uuid,
  name text not null check (length(trim(name)) between 1 and 100),
  name_ur text check (name_ur is null or length(name_ur) <= 100),
  unit text not null check (unit in ('kg', 'g', 'dozen', 'piece', 'bundle', 'litre')),
  sale_price_paisa bigint not null default 0 check (sale_price_paisa >= 0),
  barcode text check (barcode is null or length(barcode) between 1 and 64),
  track_stock boolean not null default false,
  min_qty_milli bigint check (min_qty_milli is null or min_qty_milli >= 0),
  is_combo boolean not null default false,
  packaging_cost_paisa bigint not null default 0 check (packaging_cost_paisa >= 0),
  foc_rule jsonb,
  search_terms text[] not null default '{}' check (public.search_terms_ok(search_terms)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  unique (id, shop_id),
  -- composite FK: a product's category is always in the same shop (null = no category)
  foreign key (category_id, shop_id) references public.categories (id, shop_id)
);
create index products_shop_id_idx on public.products (shop_id);
create index products_server_seq_idx on public.products (server_seq);
alter table public.products enable row level security;

-- ---------------------------------------------------------------------------
-- product_costs (owner-only current cost)
-- ---------------------------------------------------------------------------
create table public.product_costs (
  product_id uuid primary key,
  shop_id uuid not null references public.shops (id),
  cost_price_paisa bigint not null check (cost_price_paisa >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  foreign key (product_id, shop_id) references public.products (id, shop_id)
);
create index product_costs_shop_id_idx on public.product_costs (shop_id);
create index product_costs_server_seq_idx on public.product_costs (server_seq);
alter table public.product_costs enable row level security;

-- ---------------------------------------------------------------------------
-- price_history (append-only, sale prices only) and product_cost_history (append-only,
-- owner-only)
-- ---------------------------------------------------------------------------
create table public.price_history (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  product_id uuid not null,
  sale_price_paisa bigint not null check (sale_price_paisa >= 0),
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  device_id uuid,
  server_seq bigint not null,
  foreign key (product_id, shop_id) references public.products (id, shop_id)
);
create index price_history_product_id_idx on public.price_history (product_id, effective_at);
create index price_history_server_seq_idx on public.price_history (server_seq);
alter table public.price_history enable row level security;

create table public.product_cost_history (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  product_id uuid not null,
  cost_price_paisa bigint not null check (cost_price_paisa >= 0),
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  device_id uuid,
  server_seq bigint not null,
  foreign key (product_id, shop_id) references public.products (id, shop_id)
);
create index product_cost_history_product_id_idx
  on public.product_cost_history (product_id, effective_at);
create index product_cost_history_server_seq_idx on public.product_cost_history (server_seq);
alter table public.product_cost_history enable row level security;

create trigger set_server_seq before insert or update on public.categories
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.products
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.product_costs
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.price_history
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.product_cost_history
  for each row execute function public.set_server_seq();

-- ---------------------------------------------------------------------------
-- Privileges and policies. No deletes anywhere (soft delete); the two history tables have no
-- update privilege at all (append-only).
-- ---------------------------------------------------------------------------
revoke all on public.categories, public.products, public.product_costs, public.price_history,
  public.product_cost_history from public;
grant select, insert, update on public.categories, public.products, public.product_costs
  to naqdpos_app;
grant select, insert on public.price_history, public.product_cost_history to naqdpos_app;

create policy categories_select_member on public.categories
  for select to naqdpos_app using (public.is_shop_member(shop_id));
create policy categories_insert_owner on public.categories
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));
create policy categories_update_owner on public.categories
  for update to naqdpos_app
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

create policy products_select_member on public.products
  for select to naqdpos_app using (public.is_shop_member(shop_id));
create policy products_insert_owner on public.products
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));
create policy products_update_owner on public.products
  for update to naqdpos_app
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

create policy product_costs_select_owner on public.product_costs
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner']));
create policy product_costs_insert_owner on public.product_costs
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));
create policy product_costs_update_owner on public.product_costs
  for update to naqdpos_app
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

create policy price_history_select_member on public.price_history
  for select to naqdpos_app using (public.is_shop_member(shop_id));
create policy price_history_insert_owner on public.price_history
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));

create policy product_cost_history_select_owner on public.product_cost_history
  for select to naqdpos_app using (public.has_shop_role(shop_id, array['owner']));
create policy product_cost_history_insert_owner on public.product_cost_history
  for insert to naqdpos_app with check (public.has_shop_role(shop_id, array['owner']));

-- ---------------------------------------------------------------------------
-- Sync registry
-- ---------------------------------------------------------------------------
insert into public.sync_tables
  (table_name, kind, id_column, shop_column, pushable, push_columns, pull_scope, write_roles)
values
  ('categories', 'mutable', 'id', 'shop_id', true,
    array['id', 'shop_id', 'name', 'name_ur', 'sort', 'created_at', 'updated_at', 'deleted_at',
      'device_id'],
    'all', array['owner']),
  ('products', 'mutable', 'id', 'shop_id', true,
    array['id', 'shop_id', 'category_id', 'name', 'name_ur', 'unit', 'sale_price_paisa',
      'barcode', 'track_stock', 'min_qty_milli', 'is_combo', 'packaging_cost_paisa', 'foc_rule',
      'search_terms', 'created_at', 'updated_at', 'deleted_at', 'device_id'],
    'all', array['owner']),
  ('product_costs', 'mutable', 'product_id', 'shop_id', true,
    array['product_id', 'shop_id', 'cost_price_paisa', 'created_at', 'updated_at', 'deleted_at',
      'device_id'],
    'owner_device', array['owner']),
  ('price_history', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'product_id', 'sale_price_paisa', 'effective_at', 'created_at',
      'device_id'],
    'all', array['owner']),
  ('product_cost_history', 'append', 'id', 'shop_id', true,
    array['id', 'shop_id', 'product_id', 'cost_price_paisa', 'effective_at', 'created_at',
      'device_id'],
    'owner_device', array['owner']);

-- migrate:down

delete from public.sync_tables where table_name in
  ('categories', 'products', 'product_costs', 'price_history', 'product_cost_history');
drop table public.product_cost_history, public.price_history, public.product_costs,
  public.products, public.categories;
drop function public.search_terms_ok(text[]);
