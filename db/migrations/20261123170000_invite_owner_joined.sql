-- migrate:up
-- US012 fix: once the shop's owner staff row is linked to a user (the owner has joined), a new
-- invite would only add a second owner login without a staff row of its own. Refuse it with
-- SQLSTATE NQ001 (API: 409 owner_joined) until second owners are supported. Pending, expired
-- or revoked invites for an unlinked owner row still allow a new invite.
create or replace function public.admin_create_invite(p_shop_id uuid, p_email text)
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
  if exists (select 1 from public.staff s
             where s.shop_id = p_shop_id and s.role = 'owner' and s.deleted_at is null
               and s.membership_user_id is not null) then
    raise exception 'the owner has already joined this shop' using errcode = 'NQ001';
  end if;
  select s.id into v_staff from public.staff s
  where s.shop_id = p_shop_id and s.role = 'owner' and s.deleted_at is null
  order by s.created_at limit 1;
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

-- migrate:down
create or replace function public.admin_create_invite(p_shop_id uuid, p_email text)
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
  update public.invites set revoked_at = now()
  where shop_id = p_shop_id and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.invites (shop_id, email, staff_id, created_by_user_id)
  values (p_shop_id, v_email, v_staff, public.current_user_id())
  returning id into v_id;
  perform public.admin_audit(p_shop_id, 'invite.create', 'invites', v_id, jsonb_build_object('email', v_email));
  return v_id;
end;
$$;
