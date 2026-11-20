-- migrate:up

-- Change a device's mode (owner phone ↔ shop counter) after registration (docs/progress.md
-- Step 8). Owner only, audit-logged. The devices server_seq trigger bumps the row, so every
-- device of the shop pulls the new mode.

create function public.set_device_mode(p_device_id uuid, p_mode text)
returns public.devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
  v_device public.devices;
  v_old text;
begin
  if v_uid is null then
    raise exception 'set_device_mode: not signed in' using errcode = '42501';
  end if;

  select * into v_device from public.devices d
  where d.id = p_device_id and d.deleted_at is null
  for update;
  -- Unknown and not-yours look the same, so the answer never reveals other shops' devices.
  if not found or not public.has_shop_role(v_device.shop_id, array['owner']) then
    raise exception 'set_device_mode: only the shop owner can change a device'
      using errcode = '42501';
  end if;

  if v_device.mode = p_mode then
    return v_device; -- already so (a retry): nothing to change or log
  end if;
  v_old := v_device.mode;

  update public.devices d set mode = p_mode, updated_at = now()
  where d.id = p_device_id
  returning * into v_device;

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (v_device.shop_id, v_uid, 'device.mode', 'devices', p_device_id,
    jsonb_build_object('from', v_old, 'to', p_mode));

  return v_device;
end;
$$;

revoke all on function public.set_device_mode(uuid, text) from public;
grant execute on function public.set_device_mode(uuid, text) to naqdpos_app;

-- migrate:down

drop function public.set_device_mode(uuid, text);
