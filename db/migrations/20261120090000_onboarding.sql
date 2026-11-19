-- migrate:up

-- Owner onboarding and device registration (docs/progress.md Step 4).
-- 1. create_shop() also stores the owner's PIN hash (PBKDF2 string made on the device, §5).
-- 2. register_device(): owner registers a device; the server assigns its receipt code (§4).

-- ---------------------------------------------------------------------------
-- create_shop: same as 20261119120000_foundation plus p_owner_pin_hash. The signature
-- changes, so the old function is dropped (it was only ever called by POST /shops).
-- ---------------------------------------------------------------------------
drop function public.create_shop(uuid, text, text, uuid, text, text, text, text, uuid);

create function public.create_shop(
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

  insert into public.staff (id, shop_id, name, phone, role, pin_hash, membership_user_id, device_id)
  values (p_owner_staff_id, p_shop_id, p_owner_name, p_owner_phone, 'owner', p_owner_pin_hash,
    v_uid, p_device_id);

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'shop.create', 'shops', p_shop_id,
    jsonb_build_object('name', p_name, 'type', p_type, 'owner_staff_id', p_owner_staff_id));

  return p_shop_id;
end;
$$;

revoke all on function public.create_shop(uuid, text, text, uuid, text, text, text, text, text, uuid)
  from public;
grant execute on function public.create_shop(uuid, text, text, uuid, text, text, text, text, text, uuid)
  to naqdpos_app;

-- ---------------------------------------------------------------------------
-- register_device: the owner registers a device (POST /devices). Codes are A1…A999, then
-- B1…B999, and so on, in registration order per shop. Devices are never deleted (soft delete),
-- so the count never goes down and a code is never reused.
--
-- security definer because choosing the next code must see every device of the shop and lock
-- the shop row; so the owner check is done here explicitly. Locking the shop row makes two
-- registrations at the same moment queue up instead of picking the same code.
-- A retry with the same device id for the same shop returns the existing row (idempotent).
-- ---------------------------------------------------------------------------
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
      return v_existing; -- retry of a request that already succeeded
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

-- migrate:down

drop function public.register_device(uuid, uuid, text);
drop function public.create_shop(uuid, text, text, uuid, text, text, text, text, text, uuid);

-- Restore the foundation version of create_shop (without the PIN hash).
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

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (p_shop_id, v_uid, 'shop.create', 'shops', p_shop_id,
    jsonb_build_object('name', p_name, 'type', p_type, 'owner_staff_id', p_owner_staff_id));

  return p_shop_id;
end;
$$;

revoke all on function public.create_shop(uuid, text, text, uuid, text, text, text, text, uuid)
  from public;
grant execute on function public.create_shop(uuid, text, text, uuid, text, text, text, text, uuid)
  to naqdpos_app;
