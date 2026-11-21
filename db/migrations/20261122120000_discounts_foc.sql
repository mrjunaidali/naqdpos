-- migrate:up
-- Discounts and free (FOC) items (US032, US033; architecture §3, §5).
-- 1. shops.cashier_max_discount_pct (0–100, default 10): a cashier's give-away per bill (line
--    discounts + bill discount + FOC value) stays within this % of the paid lines' price, or an
--    owner approves with their PIN. Enforced in core (the server cannot tell who stands at a
--    shared device); the approver is recorded in sales.discount_approved_by_staff_id.
-- 2. sales.discount_paisa is the bill discount only; sale_lines.line_total_paisa is the line net
--    of its own discount; a free line totals 0 and has no discount.
-- 3. products.foc_rule: null or exactly {min_bill_paisa, qty_milli}.

alter table public.shops
  add column cashier_max_discount_pct integer not null default 10
    check (cashier_max_discount_pct between 0 and 100);
grant update (cashier_max_discount_pct) on public.shops to naqdpos_app;
update public.sync_tables set push_columns = push_columns || array['cashier_max_discount_pct']
where table_name = 'shops';
-- Touch every shop once so devices that already hold the row pull the new column.
update public.shops set updated_at = updated_at;

alter table public.sales
  add column discount_approved_by_staff_id uuid,
  add foreign key (discount_approved_by_staff_id, shop_id) references public.staff (id, shop_id),
  add constraint sales_discount_within_subtotal check (discount_paisa <= subtotal_paisa);
update public.sync_tables set push_columns = push_columns || array['discount_approved_by_staff_id']
where table_name = 'sales';

-- The approver must be an owner of the shop (who approved is part of the audit trail).
create function public.sales_check_approver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.discount_approved_by_staff_id is not null and not exists (
      select 1 from public.staff s
      where s.id = new.discount_approved_by_staff_id and s.shop_id = new.shop_id
        and s.role = 'owner') then
    raise exception 'sales: the discount approver must be an owner'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.sales_check_approver() from public;
create trigger sales_check_approver before insert on public.sales
  for each row execute function public.sales_check_approver();

alter table public.sale_lines
  add constraint sale_lines_foc_free check (not is_foc or (line_total_paisa = 0 and discount_paisa = 0));

-- foc_rule: { "min_bill_paisa": integer >= 0, "qty_milli": integer 1..9,999,000 }, no other keys.
create function public.foc_rule_ok(p_rule jsonb)
returns boolean
language sql
immutable
as $$
  select p_rule is null or (
    jsonb_typeof(p_rule) = 'object'
    and (select array_agg(k order by k) from jsonb_object_keys(p_rule) k)
      = array['min_bill_paisa', 'qty_milli']
    and jsonb_typeof(p_rule -> 'min_bill_paisa') = 'number'
    and jsonb_typeof(p_rule -> 'qty_milli') = 'number'
    and (p_rule ->> 'min_bill_paisa') ~ '^[0-9]{1,15}$'
    and (p_rule ->> 'qty_milli') ~ '^[0-9]{1,7}$'
    and (p_rule ->> 'qty_milli')::bigint between 1 and 9999000
  );
$$;
revoke all on function public.foc_rule_ok(jsonb) from public;
-- The check constraint runs as the inserting role, so the app role needs it.
grant execute on function public.foc_rule_ok(jsonb) to naqdpos_app;
alter table public.products add constraint products_foc_rule_ok check (public.foc_rule_ok(foc_rule));

-- migrate:down
alter table public.products drop constraint products_foc_rule_ok;
drop function public.foc_rule_ok(jsonb);
alter table public.sale_lines drop constraint sale_lines_foc_free;
drop trigger sales_check_approver on public.sales;
drop function public.sales_check_approver();
update public.sync_tables
set push_columns = array_remove(push_columns, 'discount_approved_by_staff_id')
where table_name = 'sales';
alter table public.sales drop constraint sales_discount_within_subtotal;
alter table public.sales drop column discount_approved_by_staff_id;
update public.sync_tables set push_columns = array_remove(push_columns, 'cashier_max_discount_pct')
where table_name = 'shops';
alter table public.shops drop column cashier_max_discount_pct;
