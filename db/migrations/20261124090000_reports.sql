-- migrate:up
-- Owner reports (US047, US048, US049, US068; architecture §3 "Reports", §5, §9). Functions only,
-- no tables. The same formulas as packages/core/src/reports.ts, checked against the shared
-- fixture packages/core/src/fixtures/report-month.json.
--
-- Security: SECURITY INVOKER plus an explicit owner check (report_assert). Owners can already
-- read every table these reports use (including product_cost_history) through RLS, so nothing
-- needs to bypass it: a cashier, rider or another shop's owner is refused by the check, and RLS
-- would still limit rows to the caller's own shops if the check were ever wrong.
--
-- Rules: business_date ranges of at most 366 days; cost at the sale's created_at (latest
-- product_cost_history row with effective_at <= created_at, ties by id); a line's net sales =
-- its line total + its share of (rounding - bill discount), shared by line totals with cumulative
-- rounding so the shares add up exactly; sales without a cost price are never in profit;
-- wastage / damaged valued at cost at the movement's created_at; earlier days with activity and
-- no day close are "unclosed", today (in range, not closed) is "still open".

create function public.report_assert(p_shop_id uuid, p_from date, p_to date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.has_shop_role(p_shop_id, array['owner']) then
    raise exception 'reports are for the shop owner' using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from + 1 > 366 then
    raise exception 'report range: from <= to, at most 366 days' using errcode = '22023';
  end if;
end;
$$;

-- The cost in effect at a time (null = no cost price known then).
create function public.report_cost_at(p_shop_id uuid, p_product_id uuid, p_at timestamptz)
returns bigint
language sql
stable
set search_path = ''
as $$
  select h.cost_price_paisa from public.product_cost_history h
  where h.shop_id = p_shop_id and h.product_id = p_product_id and h.effective_at <= p_at
  order by h.effective_at desc, h.id desc
  limit 1;
$$;

-- Sale lines of the range with net sales (bill adjustment shared) and cost at sale time.
create function public.report_lines(p_shop_id uuid, p_from date, p_to date)
returns table (
  line_id uuid,
  sale_id uuid,
  sale_created_at timestamptz,
  staff_id uuid,
  product_id uuid,
  name_snapshot text,
  name_ur_snapshot text,
  unit_snapshot text,
  qty_milli bigint,
  unit_price_paisa bigint,
  line_discount_paisa bigint,
  is_foc boolean,
  line_total_paisa bigint,
  net_paisa bigint,
  cost_paisa bigint
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.report_assert(p_shop_id, p_from, p_to);
  return query
  with l as (
    select sl.*, s.created_at as s_created_at, s.staff_id as s_staff_id,
      (s.rounding_paisa - s.discount_paisa)::numeric as adjust,
      sum(sl.line_total_paisa) over (partition by sl.sale_id)::numeric as base,
      sum(sl.line_total_paisa) over (partition by sl.sale_id order by sl.id
        rows between unbounded preceding and current row)::numeric as cum
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id and s.shop_id = sl.shop_id
    where s.shop_id = p_shop_id and s.business_date between p_from and p_to
  )
  select l.id, l.sale_id, l.s_created_at, l.s_staff_id, l.product_id, l.name_snapshot,
    l.name_ur_snapshot, l.unit_snapshot, l.qty_milli::bigint, l.unit_price_paisa::bigint,
    l.discount_paisa::bigint, l.is_foc, l.line_total_paisa::bigint,
    (l.line_total_paisa + case when l.base = 0 then 0
      else round(l.adjust * l.cum / l.base) - round(l.adjust * (l.cum - l.line_total_paisa) / l.base)
      end)::bigint,
    (select round(abs(l.qty_milli) * c / 1000.0)::bigint
       from public.report_cost_at(p_shop_id, l.product_id, l.s_created_at) c
       where c is not null)
  from l;
end;
$$;

-- {key, amount_paisa} pairs, largest first, zero totals left out (same order as core).
create function public.report_grouped(p_pairs jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'amount_paisa', amount)
    order by amount desc, key collate "C"), '[]'::jsonb)
  from (
    select p ->> 'key' as key, sum((p ->> 'amount')::bigint) as amount
    from jsonb_array_elements(p_pairs) p
    group by 1
  ) g
  where amount <> 0;
$$;

-- Earlier days with activity and no close; today (in range, not closed) is still open.
create function public.report_open_days(p_shop_id uuid, p_from date, p_to date, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with active as (
    select business_date d from public.sales where shop_id = p_shop_id and business_date between p_from and p_to
    union select business_date from public.payments where shop_id = p_shop_id and business_date between p_from and p_to
    union select business_date from public.khata_entries where shop_id = p_shop_id and business_date between p_from and p_to
    union select business_date from public.stock_movements where shop_id = p_shop_id and business_date between p_from and p_to
    union select business_date from public.expenses where shop_id = p_shop_id and business_date between p_from and p_to
  )
  select jsonb_build_object(
    'unclosed_days', coalesce((select jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d) from active a
      where a.d < p_today
        and not exists (select 1 from public.day_closes c where c.shop_id = p_shop_id and c.business_date = a.d)),
      '[]'::jsonb),
    'today_open', p_today between p_from and p_to
      and not exists (select 1 from public.day_closes c where c.shop_id = p_shop_id and c.business_date = p_today));
$$;

-- The shop's business date now (Asia/Karachi unless the shop says otherwise).
create function public.report_today(p_shop_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce((select s.timezone from public.shops s where s.id = p_shop_id), 'Asia/Karachi'))::date;
$$;

create function public.report_summary(p_shop_id uuid, p_from date, p_to date, p_today date default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, public.report_today(p_shop_id));
  v jsonb;
  v_gross bigint;
  v_line_discounts bigint;
  v_costed_sales bigint;
  v_cogs bigint;
  v_uncosted_sales bigint;
  v_uncosted_lines bigint;
  v_uncosted_products bigint;
  v_foc_lines bigint;
  v_foc_value bigint;
  v_expenses bigint;
  v_wastage bigint;
begin
  perform public.report_assert(p_shop_id, p_from, p_to);
  select coalesce(sum(line_total_paisa + line_discount_paisa), 0),
         coalesce(sum(line_discount_paisa), 0),
         coalesce(sum(net_paisa) filter (where cost_paisa is not null), 0),
         coalesce(sum(cost_paisa), 0),
         coalesce(sum(net_paisa) filter (where cost_paisa is null), 0),
         count(*) filter (where cost_paisa is null),
         count(distinct coalesce(product_id::text, 'custom:' || lower(trim(name_snapshot))))
           filter (where cost_paisa is null),
         count(*) filter (where is_foc),
         coalesce(sum(round(qty_milli * unit_price_paisa / 1000.0)) filter (where is_foc), 0)
    into v_gross, v_line_discounts, v_costed_sales, v_cogs, v_uncosted_sales, v_uncosted_lines,
         v_uncosted_products, v_foc_lines, v_foc_value
    from public.report_lines(p_shop_id, p_from, p_to);
  select coalesce(sum(amount_paisa), 0) into v_expenses from public.expenses
    where shop_id = p_shop_id and business_date between p_from and p_to;
  select coalesce(sum(round(abs(m.qty_milli) * c / 1000.0)), 0) into v_wastage
    from public.stock_movements m
    cross join lateral public.report_cost_at(p_shop_id, m.product_id, m.created_at) c
    where m.shop_id = p_shop_id and m.business_date between p_from and p_to
      and m.reason in ('wastage', 'damaged') and c is not null;

  select jsonb_build_object(
    'from', to_char(p_from, 'YYYY-MM-DD'),
    'to', to_char(p_to, 'YYYY-MM-DD'),
    'sales_count', (select count(*) from public.sales where shop_id = p_shop_id and business_date between p_from and p_to),
    'gross_sales_paisa', v_gross,
    'line_discount_paisa', v_line_discounts,
    'bill_discount_paisa', (select coalesce(sum(discount_paisa), 0) from public.sales where shop_id = p_shop_id and business_date between p_from and p_to),
    'rounding_paisa', (select coalesce(sum(rounding_paisa), 0) from public.sales where shop_id = p_shop_id and business_date between p_from and p_to),
    'net_sales_paisa', (select coalesce(sum(total_paisa), 0) from public.sales where shop_id = p_shop_id and business_date between p_from and p_to),
    'payments_by_method', public.report_grouped((select coalesce(jsonb_agg(jsonb_build_object('key', method_code, 'amount', amount_paisa)), '[]')
      from public.payments where shop_id = p_shop_id and business_date between p_from and p_to and kind = 'sale')),
    'khata_receipts_by_method', public.report_grouped((select coalesce(jsonb_agg(jsonb_build_object('key', method_code, 'amount', amount_paisa)), '[]')
      from public.payments where shop_id = p_shop_id and business_date between p_from and p_to and kind = 'khata_receipt')),
    'khata_given_paisa', (select coalesce(sum(amount_paisa), 0) from public.khata_entries
      where shop_id = p_shop_id and business_date between p_from and p_to and type = 'credit_sale'),
    'khata_received_paisa', (select coalesce(-sum(amount_paisa), 0) from public.khata_entries
      where shop_id = p_shop_id and business_date between p_from and p_to and type = 'payment'),
    'foc_lines', v_foc_lines,
    'foc_value_paisa', v_foc_value,
    'costed_sales_paisa', v_costed_sales,
    'cost_of_goods_paisa', v_cogs,
    'costed_profit_paisa', v_costed_sales - v_cogs,
    'uncosted_sales_paisa', v_uncosted_sales,
    'uncosted_lines', v_uncosted_lines,
    'uncosted_products', v_uncosted_products,
    'expenses_total_paisa', v_expenses,
    'expenses_by_category', (select coalesce(jsonb_agg(g || jsonb_build_object('name', c.name, 'name_ur', c.name_ur, 'i18n_key', c.i18n_key)
        order by (g ->> 'amount_paisa')::bigint desc, (g ->> 'key') collate "C"), '[]'::jsonb)
      from jsonb_array_elements(public.report_grouped((select coalesce(jsonb_agg(jsonb_build_object('key', e.category_id, 'amount', e.amount_paisa)), '[]')
        from public.expenses e where e.shop_id = p_shop_id and e.business_date between p_from and p_to))) g
      left join public.expense_categories c on c.id = (g ->> 'key')::uuid),
    'wastage_value_paisa', v_wastage,
    'wastage_unvalued_lines', (select count(*) from public.stock_movements m
      where m.shop_id = p_shop_id and m.business_date between p_from and p_to and m.reason in ('wastage', 'damaged')
        and public.report_cost_at(p_shop_id, m.product_id, m.created_at) is null),
    'net_paisa', v_costed_sales - v_cogs - v_expenses - v_wastage,
    'receivables_paisa', (select coalesce(sum(b), 0) from (
      select sum(amount_paisa) b from public.khata_entries
      where shop_id = p_shop_id and business_date <= p_to group by customer_id) x where b > 0),
    'receivable_customers', (select count(*) from (
      select sum(amount_paisa) b from public.khata_entries
      where shop_id = p_shop_id and business_date <= p_to group by customer_id) x where b > 0)
  ) || public.report_open_days(p_shop_id, p_from, p_to, v_today) into v;
  return v;
end;
$$;

create function public.report_products(p_shop_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.report_assert(p_shop_id, p_from, p_to);
  return (
    with l as (
      select r.*, coalesce(r.product_id::text, 'custom:' || lower(trim(r.name_snapshot))) as key
      from public.report_lines(p_shop_id, p_from, p_to) r
    ), g as (
      select l.key, l.product_id,
        (array_agg(trim(l.name_snapshot) order by l.sale_created_at, l.sale_id, l.line_id))[1] as first_name,
        (array_agg(l.name_ur_snapshot order by l.sale_created_at, l.sale_id, l.line_id))[1] as first_name_ur,
        (array_agg(l.unit_snapshot order by l.sale_created_at, l.sale_id, l.line_id))[1] as first_unit,
        count(*) as lines,
        sum(l.qty_milli) as qty_milli,
        coalesce(sum(l.qty_milli) filter (where l.is_foc), 0) as foc_qty_milli,
        sum(l.net_paisa) as sales_paisa,
        coalesce(sum(l.net_paisa) filter (where l.cost_paisa is not null), 0) as costed_sales_paisa,
        coalesce(sum(l.cost_paisa), 0) as cost_paisa,
        coalesce(sum(l.net_paisa - l.cost_paisa) filter (where l.cost_paisa is not null), 0) as profit_paisa,
        coalesce(sum(l.net_paisa) filter (where l.cost_paisa is null), 0) as uncosted_sales_paisa
      from l group by l.key, l.product_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'key', g.key,
        'product_id', g.product_id,
        'name', coalesce(p.name, g.first_name),
        'name_ur', case when p.id is not null then p.name_ur else g.first_name_ur end,
        'unit', coalesce(p.unit, g.first_unit),
        'custom', g.product_id is null,
        'lines', g.lines,
        'qty_milli', g.qty_milli,
        'foc_qty_milli', g.foc_qty_milli,
        'sales_paisa', g.sales_paisa,
        'costed_sales_paisa', g.costed_sales_paisa,
        'cost_paisa', g.cost_paisa,
        'profit_paisa', g.profit_paisa,
        'uncosted_sales_paisa', g.uncosted_sales_paisa)
      order by g.sales_paisa desc, g.key collate "C"), '[]'::jsonb)
    from g left join public.products p on p.id = g.product_id and p.shop_id = p_shop_id
  );
end;
$$;

create function public.report_staff(p_shop_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.report_assert(p_shop_id, p_from, p_to);
  return (
    with s as (
      select s.id, s.staff_id, s.total_paisa, s.discount_paisa,
        coalesce((select sum(sl.discount_paisa) from public.sale_lines sl where sl.sale_id = s.id), 0) as line_discounts,
        coalesce((select sum(round(sl.qty_milli * sl.unit_price_paisa / 1000.0)) from public.sale_lines sl
          where sl.sale_id = s.id and sl.is_foc), 0) as foc_value
      from public.sales s where s.shop_id = p_shop_id and s.business_date between p_from and p_to
    ), g as (
      select staff_id, count(*) as sales_count, sum(total_paisa) as sales_paisa,
        sum(discount_paisa + line_discounts) as discount_paisa, sum(foc_value) as foc_value_paisa
      from s group by staff_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'staff_id', g.staff_id, 'name', coalesce(st.name, ''), 'sales_count', g.sales_count,
        'sales_paisa', g.sales_paisa, 'discount_paisa', g.discount_paisa, 'foc_value_paisa', g.foc_value_paisa)
      order by g.sales_paisa desc, g.staff_id), '[]'::jsonb)
    from g left join public.staff st on st.id = g.staff_id
  );
end;
$$;

-- Expense lines (newest first, at most 5000) with totals, and the previous period's totals: the
-- previous calendar month for a whole month, else the same number of days just before.
create function public.report_expenses(
  p_shop_id uuid,
  p_from date,
  p_to date,
  p_category_id uuid default null,
  p_method_code text default null,
  p_staff_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_prev_from date;
  v_prev_to date;
begin
  perform public.report_assert(p_shop_id, p_from, p_to);
  if p_from = date_trunc('month', p_from)::date
     and p_to = (date_trunc('month', p_from) + interval '1 month - 1 day')::date then
    v_prev_to := p_from - 1;
    v_prev_from := date_trunc('month', v_prev_to)::date;
  else
    v_prev_to := p_from - 1;
    v_prev_from := p_from - (p_to - p_from + 1);
  end if;
  return (
    with e as (
      select x.* from public.expenses x
      where x.shop_id = p_shop_id
        and (p_category_id is null or x.category_id = p_category_id)
        and (p_method_code is null or x.paid_method_code = p_method_code)
        and (p_staff_id is null or x.staff_id = p_staff_id)
    ), cur as (select * from e where business_date between p_from and p_to),
    prev as (select * from e where business_date between v_prev_from and v_prev_to)
    select jsonb_build_object(
      'from', to_char(p_from, 'YYYY-MM-DD'),
      'to', to_char(p_to, 'YYYY-MM-DD'),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c.id, 'business_date', to_char(c.business_date, 'YYYY-MM-DD'), 'category_id', c.category_id,
          'category_name', cat.name, 'category_name_ur', cat.name_ur, 'category_i18n_key', cat.i18n_key,
          'amount_paisa', c.amount_paisa, 'paid_method_code', c.paid_method_code, 'note', c.note,
          'payee', c.payee, 'staff_id', c.staff_id, 'staff_name', st.name,
          'reverses_expense_id', c.reverses_expense_id, 'reversal_reason', c.reversal_reason,
          'created_at', c.created_at)
          order by c.business_date desc, c.created_at desc, c.id desc)
        from (select * from cur order by business_date desc, created_at desc, id desc limit 5000) c
        left join public.expense_categories cat on cat.id = c.category_id
        left join public.staff st on st.id = c.staff_id), '[]'::jsonb),
      'line_count', (select count(*) from cur),
      'total_paisa', (select coalesce(sum(amount_paisa), 0) from cur),
      'by_category', public.report_grouped((select coalesce(jsonb_agg(jsonb_build_object('key', category_id, 'amount', amount_paisa)), '[]') from cur)),
      'by_method', public.report_grouped((select coalesce(jsonb_agg(jsonb_build_object('key', paid_method_code, 'amount', amount_paisa)), '[]') from cur)),
      'previous', jsonb_build_object(
        'from', to_char(v_prev_from, 'YYYY-MM-DD'),
        'to', to_char(v_prev_to, 'YYYY-MM-DD'),
        'total_paisa', (select coalesce(sum(amount_paisa), 0) from prev),
        'by_category', public.report_grouped((select coalesce(jsonb_agg(jsonb_build_object('key', category_id, 'amount', amount_paisa)), '[]') from prev)))
    )
  );
end;
$$;

revoke all on function public.report_assert(uuid, date, date) from public;
revoke all on function public.report_cost_at(uuid, uuid, timestamptz) from public;
revoke all on function public.report_lines(uuid, date, date) from public;
revoke all on function public.report_grouped(jsonb) from public;
revoke all on function public.report_open_days(uuid, date, date, date) from public;
revoke all on function public.report_today(uuid) from public;
revoke all on function public.report_summary(uuid, date, date, date) from public;
revoke all on function public.report_products(uuid, date, date) from public;
revoke all on function public.report_staff(uuid, date, date) from public;
revoke all on function public.report_expenses(uuid, date, date, uuid, text, uuid) from public;
grant execute on function public.report_assert(uuid, date, date) to naqdpos_app;
grant execute on function public.report_cost_at(uuid, uuid, timestamptz) to naqdpos_app;
grant execute on function public.report_lines(uuid, date, date) to naqdpos_app;
grant execute on function public.report_grouped(jsonb) to naqdpos_app;
grant execute on function public.report_open_days(uuid, date, date, date) to naqdpos_app;
grant execute on function public.report_today(uuid) to naqdpos_app;
grant execute on function public.report_summary(uuid, date, date, date) to naqdpos_app;
grant execute on function public.report_products(uuid, date, date) to naqdpos_app;
grant execute on function public.report_staff(uuid, date, date) to naqdpos_app;
grant execute on function public.report_expenses(uuid, date, date, uuid, text, uuid) to naqdpos_app;

-- migrate:down
drop function public.report_expenses(uuid, date, date, uuid, text, uuid);
drop function public.report_staff(uuid, date, date);
drop function public.report_products(uuid, date, date);
drop function public.report_summary(uuid, date, date, date);
drop function public.report_today(uuid);
drop function public.report_open_days(uuid, date, date, date);
drop function public.report_grouped(jsonb);
drop function public.report_lines(uuid, date, date);
drop function public.report_cost_at(uuid, uuid, timestamptz);
drop function public.report_assert(uuid, date, date);
