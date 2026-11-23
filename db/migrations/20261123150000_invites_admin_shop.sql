-- migrate:up
-- Admin creates shops and invites owners (US012); admin acts as a shop (US013). Architecture §5.
-- 1. invites: matched by the VERIFIED email of the user who signs in (no link or token). One
--    pending invite per (shop, email); 14 days; not synced; no privileges for naqdpos_app.
-- 2. accept_invites(): called by GET /me. owner_set_first_pin(): the invited owner's own first
--    PIN (admins never set or see owner PINs).
-- 3. Admin writes: security-definer functions, is_platform_admin() first, audit_log with
--    acting_as_admin = true and the shop_id; normal rows (UUIDv7 ids, server_seq from the usual
--    triggers, device_id null = written by an admin) so the shop's devices pull them.

-- UUIDv7 in SQL (same layout as uuidv7() in packages/core): 48-bit Unix ms, version 7, variant,
-- random rest. Plain SQL so any recent PostgreSQL can rebuild the database.
create function public.uuid_v7()
returns uuid
language sql
volatile
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6),
        52, 1),
      53, 1), 'hex')::uuid;
$$;

create table public.invites (
  id uuid primary key default public.uuid_v7(),
  shop_id uuid not null references public.shops (id),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  role text not null default 'owner' check (role = 'owner'),
  staff_id uuid not null,
  created_by_user_id uuid references public.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid references public.users (id),
  revoked_at timestamptz,
  foreign key (staff_id, shop_id) references public.staff (id, shop_id)
);
-- One pending invite per shop and email.
create unique index invites_pending_idx on public.invites (shop_id, email)
  where accepted_at is null and revoked_at is null;
create index invites_email_idx on public.invites (email);
alter table public.invites enable row level security;
revoke all on public.invites from public;

-- ---------------------------------------------------------------------------
-- Accepting: the signed-in user's verified email matches a pending, unexpired invite.
-- ---------------------------------------------------------------------------
create function public.accept_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
  v_email text;
  v_verified boolean;
  v_invite public.invites;
  v_count integer := 0;
begin
  if v_uid is null then return 0; end if;
  select lower(u.email), u.email_verified into v_email, v_verified from public.users u where u.id = v_uid;
  if not coalesce(v_verified, false) then return 0; end if;
  for v_invite in
    select * from public.invites i
    where i.email = v_email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    for update
  loop
    insert into public.memberships (shop_id, user_id, role)
    values (v_invite.shop_id, v_uid, v_invite.role)
    on conflict do nothing;
    update public.staff
    set membership_user_id = v_uid, updated_at = now()
    where id = v_invite.staff_id and shop_id = v_invite.shop_id and membership_user_id is null;
    update public.invites set accepted_at = now(), accepted_user_id = v_uid where id = v_invite.id;
    insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
    values (v_invite.shop_id, v_uid, 'invite.accept', 'invites', v_invite.id,
      jsonb_build_object('email', v_email, 'staff_id', v_invite.staff_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.accept_invites() from public;
grant execute on function public.accept_invites() to naqdpos_app;

-- The invited owner sets their own first PIN (hashed on the device). Only the owner linked to
-- that staff row, and only while it has no PIN.
create function public.owner_set_first_pin(p_staff_id uuid, p_pin_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff s where s.id = p_staff_id;
  if not found or v_staff.role <> 'owner' or v_staff.membership_user_id is distinct from public.current_user_id() then
    raise exception 'only the linked owner sets this PIN' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.staff_pins p where p.staff_id = p_staff_id) then
    raise exception 'a PIN is already set' using errcode = 'unique_violation';
  end if;
  insert into public.staff_pins (staff_id, shop_id, pin_hash) values (p_staff_id, v_staff.shop_id, p_pin_hash);
  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id)
  values (v_staff.shop_id, public.current_user_id(), 'staff.first_pin', 'staff', p_staff_id);
end;
$$;
revoke all on function public.owner_set_first_pin(uuid, text) from public;
grant execute on function public.owner_set_first_pin(uuid, text) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- Admin: shops and invites
-- ---------------------------------------------------------------------------
create function public.admin_audit(p_shop_id uuid, p_action text, p_entity text, p_entity_id uuid, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (shop_id, actor_user_id, acting_as_admin, action, entity, entity_id, payload)
  values (p_shop_id, public.current_user_id(), true, p_action, p_entity, p_entity_id, p_payload);
$$;
revoke all on function public.admin_audit(uuid, text, text, uuid, jsonb) from public;

create function public.admin_assert()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.admin_assert() from public;

create function public.admin_create_invite(p_shop_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_id uuid;
  v_email text := lower(trim(p_email));
begin
  perform public.admin_assert();
  select s.id into v_staff from public.staff s
  where s.shop_id = p_shop_id and s.role = 'owner' and s.deleted_at is null
  order by (s.membership_user_id is null) desc, s.created_at limit 1;
  if v_staff is null then raise exception 'shop has no owner staff row' using errcode = 'no_data_found'; end if;
  -- A new invite replaces the pending one for the same email.
  update public.invites set revoked_at = now()
  where shop_id = p_shop_id and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.invites (shop_id, email, staff_id, created_by_user_id)
  values (p_shop_id, v_email, v_staff, public.current_user_id())
  returning id into v_id;
  perform public.admin_audit(p_shop_id, 'invite.create', 'invites', v_id, jsonb_build_object('email', v_email));
  return v_id;
end;
$$;
revoke all on function public.admin_create_invite(uuid, text) from public;
grant execute on function public.admin_create_invite(uuid, text) to naqdpos_app;

create function public.admin_revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  perform public.admin_assert();
  update public.invites set revoked_at = now()
  where id = p_invite_id and accepted_at is null and revoked_at is null
  returning shop_id into v_shop;
  if v_shop is null then raise exception 'no pending invite' using errcode = 'no_data_found'; end if;
  perform public.admin_audit(v_shop, 'invite.revoke', 'invites', p_invite_id, null);
end;
$$;
revoke all on function public.admin_revoke_invite(uuid) from public;
grant execute on function public.admin_revoke_invite(uuid) to naqdpos_app;

create function public.admin_create_shop(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid := public.uuid_v7();
  v_staff uuid := public.uuid_v7();
  v_invite uuid;
begin
  perform public.admin_assert();
  insert into public.shops (id, name, type, city, address, phone)
  values (v_shop, trim(p_input ->> 'name'), p_input ->> 'type', nullif(trim(p_input ->> 'city'), ''),
    nullif(trim(p_input ->> 'address'), ''), nullif(trim(p_input ->> 'phone'), ''));
  insert into public.staff (id, shop_id, name, phone, role)
  values (v_staff, v_shop, trim(p_input ->> 'owner_name'), p_input ->> 'owner_mobile', 'owner');
  perform public.seed_payment_methods(v_shop);
  perform public.seed_expense_categories(v_shop);
  perform public.admin_audit(v_shop, 'shop.create', 'shops', v_shop,
    jsonb_build_object('name', p_input ->> 'name', 'type', p_input ->> 'type', 'owner_staff_id', v_staff));
  v_invite := public.admin_create_invite(v_shop, p_input ->> 'owner_email');
  return jsonb_build_object('shop_id', v_shop, 'owner_staff_id', v_staff, 'invite_id', v_invite);
end;
$$;
revoke all on function public.admin_create_shop(jsonb) from public;
grant execute on function public.admin_create_shop(jsonb) to naqdpos_app;

-- ---------------------------------------------------------------------------
-- Admin acting as a shop: catalogue and staff
-- ---------------------------------------------------------------------------
create function public.admin_save_category(p_shop_id uuid, p_category jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce((p_category ->> 'id')::uuid, public.uuid_v7());
begin
  perform public.admin_assert();
  insert into public.categories (id, shop_id, name, name_ur, sort)
  values (v_id, p_shop_id, trim(p_category ->> 'name'), nullif(trim(p_category ->> 'name_ur'), ''),
    coalesce((p_category ->> 'sort')::integer,
      (select coalesce(max(c.sort), 0) + 1 from public.categories c where c.shop_id = p_shop_id)))
  on conflict (id) do update
    set name = excluded.name, name_ur = excluded.name_ur, sort = excluded.sort, updated_at = now()
    where public.categories.shop_id = p_shop_id;
  perform public.admin_audit(p_shop_id, 'category.save', 'categories', v_id, p_category);
  return v_id;
end;
$$;
revoke all on function public.admin_save_category(uuid, jsonb) from public;
grant execute on function public.admin_save_category(uuid, jsonb) to naqdpos_app;

-- One product (insert or update), with price / cost history like the shop's own writes.
create function public.admin_write_product(p_shop_id uuid, p_product jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce((p_product ->> 'id')::uuid, public.uuid_v7());
  v_old public.products;
  v_price bigint := coalesce((p_product ->> 'sale_price_paisa')::bigint, 0);
  v_cost bigint := (p_product ->> 'cost_price_paisa')::bigint;
  v_terms text[] := coalesce(array(select jsonb_array_elements_text(p_product -> 'search_terms')), '{}');
begin
  select * into v_old from public.products p where p.id = v_id;
  if found and v_old.shop_id <> p_shop_id then
    raise exception 'product of another shop' using errcode = 'insufficient_privilege';
  end if;
  insert into public.products (id, shop_id, category_id, name, name_ur, unit, sale_price_paisa,
    search_terms, icon, track_stock)
  values (v_id, p_shop_id, (p_product ->> 'category_id')::uuid, trim(p_product ->> 'name'),
    nullif(trim(p_product ->> 'name_ur'), ''), p_product ->> 'unit', v_price, v_terms,
    nullif(p_product ->> 'icon', ''), coalesce((p_product ->> 'track_stock')::boolean, false))
  on conflict (id) do update
    set category_id = excluded.category_id, name = excluded.name, name_ur = excluded.name_ur,
        unit = excluded.unit, sale_price_paisa = excluded.sale_price_paisa,
        search_terms = excluded.search_terms, icon = excluded.icon,
        -- An edit keeps the owner's stock tracking and the hidden state unless they are sent
        -- (hide / restore is admin_hide_product).
        track_stock = case when p_product ? 'track_stock' then excluded.track_stock
          else public.products.track_stock end,
        updated_at = now();
  if v_old.id is null or v_old.sale_price_paisa is distinct from v_price then
    if v_price > 0 or v_old.id is not null then
      insert into public.price_history (id, shop_id, product_id, sale_price_paisa, effective_at)
      values (public.uuid_v7(), p_shop_id, v_id, v_price, now());
    end if;
  end if;
  if v_cost is not null then
    insert into public.product_costs (product_id, shop_id, cost_price_paisa)
    values (v_id, p_shop_id, v_cost)
    on conflict (product_id) do update set cost_price_paisa = excluded.cost_price_paisa, updated_at = now()
    where public.product_costs.cost_price_paisa <> excluded.cost_price_paisa;
    if found then
      insert into public.product_cost_history (id, shop_id, product_id, cost_price_paisa, effective_at)
      values (public.uuid_v7(), p_shop_id, v_id, v_cost, now());
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.admin_write_product(uuid, jsonb) from public;

create function public.admin_save_product(p_shop_id uuid, p_product jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.admin_assert();
  v_id := public.admin_write_product(p_shop_id, p_product);
  perform public.admin_audit(p_shop_id, 'product.save', 'products', v_id, p_product - 'cost_price_paisa'
    || jsonb_build_object('cost_set', p_product ? 'cost_price_paisa'));
  return v_id;
end;
$$;
revoke all on function public.admin_save_product(uuid, jsonb) from public;
grant execute on function public.admin_save_product(uuid, jsonb) to naqdpos_app;

create function public.admin_hide_product(p_shop_id uuid, p_product_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert();
  update public.products
  set deleted_at = case when p_hidden then now() else null end, updated_at = now()
  where id = p_product_id and shop_id = p_shop_id;
  if not found then raise exception 'no such product' using errcode = 'no_data_found'; end if;
  perform public.admin_audit(p_shop_id, case when p_hidden then 'product.hide' else 'product.restore' end,
    'products', p_product_id, null);
end;
$$;
revoke all on function public.admin_hide_product(uuid, uuid, boolean) from public;
grant execute on function public.admin_hide_product(uuid, uuid, boolean) to naqdpos_app;

-- CSV and fresh-produce imports. Rows: name, name_ur, unit, category (name), sale_price_paisa,
-- cost_price_paisa, search_terms. Categories by name are created on demand. An existing product
-- (same English name, any case) is skipped or updated as chosen.
create function public.admin_import_products(p_shop_id uuid, p_rows jsonb, p_on_existing text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_existing uuid;
  v_category uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  perform public.admin_assert();
  if p_on_existing not in ('skip', 'update') then
    raise exception 'on_existing must be skip or update' using errcode = '22023';
  end if;
  for v_row in select r from jsonb_array_elements(p_rows) r loop
    v_category := null;
    if nullif(trim(v_row ->> 'category'), '') is not null then
      select c.id into v_category from public.categories c
      where c.shop_id = p_shop_id and lower(c.name) = lower(trim(v_row ->> 'category')) and c.deleted_at is null
      limit 1;
      if v_category is null then
        v_category := public.uuid_v7();
        insert into public.categories (id, shop_id, name, name_ur, sort)
        values (v_category, p_shop_id, trim(v_row ->> 'category'), nullif(trim(v_row ->> 'category_ur'), ''),
          (select coalesce(max(c.sort), 0) + 1 from public.categories c where c.shop_id = p_shop_id));
      end if;
    end if;
    select p.id into v_existing from public.products p
    where p.shop_id = p_shop_id and lower(p.name) = lower(trim(v_row ->> 'name')) limit 1;
    if v_existing is not null and p_on_existing = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    perform public.admin_write_product(p_shop_id,
      v_row - 'category' - 'category_ur' || jsonb_build_object('id', v_existing, 'category_id', v_category));
    if v_existing is null then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
  end loop;
  perform public.admin_audit(p_shop_id, 'product.import', 'products', null,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'on_existing', p_on_existing));
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;
revoke all on function public.admin_import_products(uuid, jsonb, text) from public;
grant execute on function public.admin_import_products(uuid, jsonb, text) to naqdpos_app;

-- Cashiers and riders only (owners come through invites). An optional PIN for a cashier is
-- hashed in the admin's browser; the audit entry says it was set by an admin.
create function public.admin_save_staff(p_shop_id uuid, p_staff jsonb, p_pin_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce((p_staff ->> 'id')::uuid, public.uuid_v7());
  v_role text := p_staff ->> 'role';
  v_old public.staff;
begin
  perform public.admin_assert();
  select * into v_old from public.staff s where s.id = v_id;
  if v_role not in ('cashier', 'rider') or coalesce(v_old.role, 'cashier') = 'owner' then
    raise exception 'owners are added through invites' using errcode = 'insufficient_privilege';
  end if;
  if found and v_old.shop_id <> p_shop_id then
    raise exception 'staff of another shop' using errcode = 'insufficient_privilege';
  end if;
  insert into public.staff (id, shop_id, name, phone, role, active)
  values (v_id, p_shop_id, trim(p_staff ->> 'name'), nullif(trim(p_staff ->> 'phone'), ''), v_role,
    coalesce((p_staff ->> 'active')::boolean, true))
  on conflict (id) do update
    set name = excluded.name, phone = excluded.phone, role = excluded.role, active = excluded.active,
        updated_at = now();
  if p_pin_hash is not null then
    if v_role <> 'cashier' then
      raise exception 'only cashiers get a PIN here' using errcode = '22023';
    end if;
    insert into public.staff_pins (staff_id, shop_id, pin_hash) values (v_id, p_shop_id, p_pin_hash)
    on conflict (staff_id) do update set pin_hash = excluded.pin_hash, deleted_at = null, updated_at = now();
  end if;
  perform public.admin_audit(p_shop_id, 'staff.save', 'staff', v_id,
    jsonb_build_object('name', p_staff ->> 'name', 'role', v_role, 'active', coalesce((p_staff ->> 'active')::boolean, true),
      'pin', case when p_pin_hash is null then null else 'set by admin' end));
  return v_id;
end;
$$;
revoke all on function public.admin_save_staff(uuid, jsonb, text) from public;
grant execute on function public.admin_save_staff(uuid, jsonb, text) to naqdpos_app;

-- The shop's catalogue and invites for the admin portal.
create function public.admin_shop_catalogue(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert();
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_ur', c.name_ur,
        'sort', c.sort) order by c.sort, c.name)
      from public.categories c where c.shop_id = p_shop_id and c.deleted_at is null), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_ur', p.name_ur,
        'unit', p.unit, 'category_id', p.category_id, 'sale_price_paisa', p.sale_price_paisa,
        'cost_price_paisa', pc.cost_price_paisa, 'icon', p.icon, 'search_terms', to_jsonb(p.search_terms),
        'hidden', p.deleted_at is not null) order by p.name)
      from public.products p left join public.product_costs pc on pc.product_id = p.id
      where p.shop_id = p_shop_id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'created_at', i.created_at,
        'expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at,
        'status', case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
          when i.expires_at <= now() then 'expired' else 'pending' end) order by i.created_at desc)
      from public.invites i where i.shop_id = p_shop_id), '[]'::jsonb),
    -- Phone is needed so an edit / deactivate keeps it (admin_save_staff writes the whole row).
    -- has_pin only, never the hash.
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone,
        'role', s.role, 'active', s.active,
        'has_pin', exists (select 1 from public.staff_pins sp where sp.staff_id = s.id and sp.deleted_at is null))
        order by s.role, s.name)
      from public.staff s where s.shop_id = p_shop_id), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_shop_catalogue(uuid) from public;
grant execute on function public.admin_shop_catalogue(uuid) to naqdpos_app;

-- migrate:down
drop function public.admin_shop_catalogue(uuid);
drop function public.admin_save_staff(uuid, jsonb, text);
drop function public.admin_import_products(uuid, jsonb, text);
drop function public.admin_hide_product(uuid, uuid, boolean);
drop function public.admin_save_product(uuid, jsonb);
drop function public.admin_write_product(uuid, jsonb);
drop function public.admin_save_category(uuid, jsonb);
drop function public.admin_create_shop(jsonb);
drop function public.admin_revoke_invite(uuid);
drop function public.admin_create_invite(uuid, text);
drop function public.admin_assert();
drop function public.admin_audit(uuid, text, text, uuid, jsonb);
drop function public.owner_set_first_pin(uuid, text);
drop function public.accept_invites();
drop table public.invites;
drop function public.uuid_v7();
