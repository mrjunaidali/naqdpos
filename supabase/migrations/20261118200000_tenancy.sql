-- Tenancy foundation: shops, memberships, staff, staff_salaries, devices, platform_admins, audit_log.
-- Conventions: docs/architecture.md §2. Access rules: §5.
--
-- Synced-table ids come from the device (UUIDv7, CLAUDE.md rule 2), so id columns have no default.
-- Enumerations are text + check (not Postgres enums) so values can be added without enum migrations.

-- ---------------------------------------------------------------------------
-- server_seq: one global sequence, the pull cursor for sync (§4).
-- ---------------------------------------------------------------------------
create sequence public.server_seq as bigint;
revoke all on sequence public.server_seq from public, anon, authenticated;

-- security definer so clients never need USAGE on the sequence; it also overrides any
-- server_seq value a client sends.
create function public.set_server_seq()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.server_seq := nextval('public.server_seq');
  return new;
end;
$$;
revoke all on function public.set_server_seq() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.shops (
  id uuid primary key,
  name text not null check (length(trim(name)) > 0),
  type text not null check (type in ('fruit_veg', 'grocery', 'meat', 'general')),
  address text,
  phone text,
  receipt_footer text,
  logo_path text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  plan_id text, -- no plans table yet (Release 2+), so no FK
  timezone text not null default 'Asia/Karachi',
  cashier_expense_limit_paisa bigint not null default 200000 check (cashier_expense_limit_paisa >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null
);
create index shops_server_seq_idx on public.shops (server_seq);
alter table public.shops enable row level security;

-- Created only on the server (create_shop, later invites), never by a device, so the
-- natural key is enough.
create table public.memberships (
  shop_id uuid not null references public.shops (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'cashier', 'rider')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null,
  primary key (shop_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_server_seq_idx on public.memberships (server_seq);
alter table public.memberships enable row level security;

create table public.staff (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  name text not null check (length(trim(name)) > 0),
  phone text,
  role text not null check (role in ('owner', 'cashier', 'rider')),
  pin_hash text, -- null until the PIN is set
  membership_user_id uuid references auth.users (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  unique (shop_id, membership_user_id),
  unique (id, shop_id) -- target for staff_salaries' composite FK
);
create index staff_shop_id_idx on public.staff (shop_id);
create index staff_server_seq_idx on public.staff (server_seq);
alter table public.staff enable row level security;

-- Salary is owner-only. A separate table (like product_costs) so sync_pull can skip it
-- entirely for shop devices, where cashiers can read the staff rows.
create table public.staff_salaries (
  staff_id uuid primary key,
  shop_id uuid not null references public.shops (id),
  monthly_salary_paisa bigint not null check (monthly_salary_paisa >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id uuid,
  server_seq bigint not null,
  -- composite FK: a salary row can never point at another shop's staff member
  foreign key (staff_id, shop_id) references public.staff (id, shop_id)
);
create index staff_salaries_shop_id_idx on public.staff_salaries (shop_id);
create index staff_salaries_server_seq_idx on public.staff_salaries (server_seq);
alter table public.staff_salaries enable row level security;

create table public.devices (
  id uuid primary key,
  shop_id uuid not null references public.shops (id),
  name text not null check (length(trim(name)) > 0),
  code text not null check (code ~ '^[A-Z][0-9]{1,3}$'), -- receipt-number prefix, e.g. A1 (§4)
  registered_by uuid references auth.users (id) on delete set null,
  last_sync_at timestamptz,
  last_seq_pulled bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null,
  unique (shop_id, code)
);
create index devices_shop_id_idx on public.devices (shop_id);
create index devices_server_seq_idx on public.devices (server_seq);
alter table public.devices enable row level security;

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

-- Append-only, written only by server functions. Never synced, so a server-generated id is fine.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops (id),
  actor_user_id uuid,
  acting_as_admin boolean not null default false,
  action text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb,
  at timestamptz not null default now()
);
create index audit_log_shop_id_at_idx on public.audit_log (shop_id, at);
alter table public.audit_log enable row level security;

create trigger set_server_seq before insert or update on public.shops
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.memberships
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.staff
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.staff_salaries
  for each row execute function public.set_server_seq();
create trigger set_server_seq before insert or update on public.devices
  for each row execute function public.set_server_seq();

-- ---------------------------------------------------------------------------
-- Access helpers. security definer so policies can read memberships/platform_admins
-- without recursing into their RLS. They only answer questions about the caller.
-- ---------------------------------------------------------------------------
create function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.deleted_at is null
  );
$$;

create function public.has_shop_role(p_shop_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.deleted_at is null
      and m.role = any (p_roles)
  );
$$;

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_shop_member(uuid) from public, anon;
revoke all on function public.has_shop_role(uuid, text[]) from public, anon;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_shop_member(uuid) to authenticated;
grant execute on function public.has_shop_role(uuid, text[]) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges. Supabase grants everything to anon/authenticated by default;
-- start from nothing and grant only what the policies below need.
-- ---------------------------------------------------------------------------
revoke all on public.shops, public.memberships, public.staff, public.staff_salaries,
  public.devices, public.platform_admins, public.audit_log
  from anon, authenticated;

grant select on public.shops to authenticated;
-- Owners edit shop settings only. status, plan_id and deleted_at are for admin RPCs.
grant update (name, type, address, phone, receipt_footer, logo_path, timezone,
  cashier_expense_limit_paisa, updated_at) on public.shops to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update on public.staff to authenticated;
grant select, insert, update on public.staff_salaries to authenticated;
grant select, insert, update on public.devices to authenticated;
-- platform_admins, audit_log: no client access at all.

-- ---------------------------------------------------------------------------
-- Policies. No delete policies: rows are soft-deleted via deleted_at.
-- ---------------------------------------------------------------------------
create policy shops_select_member on public.shops
  for select to authenticated using (public.is_shop_member(id));
create policy shops_update_owner on public.shops
  for update to authenticated
  using (public.has_shop_role(id, array['owner']))
  with check (public.has_shop_role(id, array['owner']));

create policy memberships_select_member on public.memberships
  for select to authenticated using (public.is_shop_member(shop_id));

create policy staff_select_member on public.staff
  for select to authenticated using (public.is_shop_member(shop_id));
create policy staff_insert_owner on public.staff
  for insert to authenticated with check (public.has_shop_role(shop_id, array['owner']));
create policy staff_update_owner on public.staff
  for update to authenticated
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

create policy staff_salaries_select_owner on public.staff_salaries
  for select to authenticated using (public.has_shop_role(shop_id, array['owner']));
create policy staff_salaries_insert_owner on public.staff_salaries
  for insert to authenticated with check (public.has_shop_role(shop_id, array['owner']));
create policy staff_salaries_update_owner on public.staff_salaries
  for update to authenticated
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

create policy devices_select_member on public.devices
  for select to authenticated using (public.is_shop_member(shop_id));
create policy devices_insert_owner on public.devices
  for insert to authenticated
  with check (public.has_shop_role(shop_id, array['owner']) and registered_by = (select auth.uid()));
create policy devices_update_owner on public.devices
  for update to authenticated
  using (public.has_shop_role(shop_id, array['owner']))
  with check (public.has_shop_role(shop_id, array['owner']));

-- ---------------------------------------------------------------------------
-- create_shop: onboarding. One transaction creates the shop, the caller's owner
-- membership and owner staff row. Ids come from the device; a retry with the same
-- shop id by the same owner is a no-op, so a lost response is safe to resend.
-- ---------------------------------------------------------------------------
create function public.create_shop(
  p_shop_id uuid,
  p_name text,
  p_type text,
  p_owner_staff_id uuid,
  p_owner_name text,
  p_owner_phone text,
  p_shop_phone text,
  p_address text default null,
  p_device_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
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

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'shop.create', 'shops', p_shop_id,
    jsonb_build_object('name', p_name, 'type', p_type, 'owner_staff_id', p_owner_staff_id));

  return p_shop_id;
end;
$$;

revoke all on function public.create_shop(uuid, text, text, uuid, text, text, text, text, uuid)
  from public, anon;
grant execute on function public.create_shop(uuid, text, text, uuid, text, text, text, text, uuid)
  to authenticated;
