-- migrate:up

-- Product pictures as emoji (US078; architecture §3, approved 21 Nov 2026). products.icon is one
-- short emoji (or null), shown on product tiles; pushable and pulled by every device. Owner
-- photos come later (US079).

-- An emoji-like string: 1–16 characters, every one from the emoji blocks (pictographs, symbols,
-- dingbats), variation selectors, the zero-width joiner or the keycap mark. Letters, digits,
-- spaces and Urdu text are refused. A function, because a check constraint cannot hold a
-- subquery; the app role needs EXECUTE because the check runs as the inserting role.
create function public.product_icon_ok(p_icon text)
returns boolean
language sql
immutable
as $$
  select p_icon is null or (
    char_length(p_icon) between 1 and 16
    and p_icon ~ '^[←-⯿\U0001F000-\U0001FAFF︎️‍⃣]+$'
  );
$$;
revoke all on function public.product_icon_ok(text) from public;
grant execute on function public.product_icon_ok(text) to naqdpos_app;

alter table public.products
  add column icon text check (public.product_icon_ok(icon));

update public.sync_tables set push_columns = push_columns || array['icon']
where table_name = 'products';

-- migrate:down

update public.sync_tables set push_columns = array_remove(push_columns, 'icon')
where table_name = 'products';
alter table public.products drop column icon;
drop function public.product_icon_ok(text);
