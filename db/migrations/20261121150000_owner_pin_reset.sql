-- migrate:up

-- Owner PIN reset by email code (docs/progress.md Step 9, architecture §5). The API checks the
-- emailed code (Better Auth email-verification OTP, used up on check); these functions decide
-- who may reset, limit how often codes are sent, and write the new PIN.
--
-- Who: the signed-in user resets their OWN owner staff row only: an active, not deleted owner
-- with membership_user_id = current_user_id(), in a shop where they are an owner. create_shop
-- has always linked the owner's staff row this way, so no backfill is needed.
-- Limits on sending codes (per user): one per 60 seconds, at most 10 per 24 hours, counted from
-- audit_log 'pin.code_sent' rows. Neither the code nor the hash is ever logged.

-- The staff row the caller may reset, or 42501. Internal: not callable by the app role.
create function public.owner_pin_target(p_staff_id uuid)
returns public.staff
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
  v_staff public.staff;
begin
  select * into v_staff from public.staff s where s.id = p_staff_id;
  if v_uid is null
    or not found
    or v_staff.role <> 'owner'
    or not v_staff.active
    or v_staff.deleted_at is not null
    or v_staff.membership_user_id is distinct from v_uid
    or not public.has_shop_role(v_staff.shop_id, array['owner']) then
    raise exception 'owner PIN reset: not allowed for this staff member' using errcode = '42501';
  end if;
  return v_staff;
end;
$$;
revoke all on function public.owner_pin_target(uuid) from public;

-- Before a code is sent: checks the caller and the limits, then records the send.
-- Returns 'ok', 'cooldown' (another code within 60 s) or 'daily_cap' (10 in 24 h).
create function public.request_pin_reset_code(p_staff_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
  v_staff public.staff := public.owner_pin_target(p_staff_id);
  v_last timestamptz;
  v_count integer;
begin
  -- Two requests at the same moment queue here instead of both passing the cooldown.
  perform pg_advisory_xact_lock(hashtext('pin.code_sent:' || v_uid::text));

  select max(a.at), count(*) into v_last, v_count
  from public.audit_log a
  where a.actor_user_id = v_uid
    and a.action = 'pin.code_sent'
    and a.at > now() - interval '24 hours';

  if v_last is not null and v_last > now() - interval '60 seconds' then
    return 'cooldown';
  end if;
  if v_count >= 10 then
    return 'daily_cap';
  end if;

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (v_staff.shop_id, v_uid, 'pin.code_sent', 'staff', v_staff.id, null);
  return 'ok';
end;
$$;
revoke all on function public.request_pin_reset_code(uuid) from public;
grant execute on function public.request_pin_reset_code(uuid) to naqdpos_app;

-- After the code was checked: write the new PIN. server_seq bumps (trigger), so the shop's other
-- owner and shop devices pull it.
create function public.reset_owner_pin(p_staff_id uuid, p_pin_hash text)
returns public.staff_pins
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff := public.owner_pin_target(p_staff_id);
  v_device uuid := nullif(current_setting('app.device_id', true), '')::uuid;
  v_row public.staff_pins;
begin
  insert into public.staff_pins (staff_id, shop_id, pin_hash, device_id)
  values (v_staff.id, v_staff.shop_id, p_pin_hash, v_device)
  on conflict (staff_id) do update
    set pin_hash = excluded.pin_hash,
        updated_at = now(),
        deleted_at = null,
        device_id = excluded.device_id
  returning * into v_row;

  insert into public.audit_log (shop_id, actor_user_id, action, entity, entity_id, payload)
  values (v_staff.shop_id, public.current_user_id(), 'pin.reset', 'staff', v_staff.id,
    jsonb_build_object('staff_id', v_staff.id));
  return v_row;
end;
$$;
revoke all on function public.reset_owner_pin(uuid, text) from public;
grant execute on function public.reset_owner_pin(uuid, text) to naqdpos_app;

-- migrate:down

drop function public.reset_owner_pin(uuid, text);
drop function public.request_pin_reset_code(uuid);
drop function public.owner_pin_target(uuid);
