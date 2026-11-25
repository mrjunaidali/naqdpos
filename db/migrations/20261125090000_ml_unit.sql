-- migrate:up
-- New product unit `ml` (approved 25 Nov 2026): whole millilitres like `g` for grams,
-- qty_milli = ml × 1000, sale price per 1 ml. Products and the sale-line snapshot share the list.
-- The checks were inline in 20261121090000_catalogue.sql and 20261121210000_sales.sql, so they
-- carry Postgres's default names.

alter table public.products drop constraint products_unit_check;
alter table public.products add constraint products_unit_check
  check (unit in ('kg', 'g', 'dozen', 'piece', 'bundle', 'litre', 'ml'));

alter table public.sale_lines drop constraint sale_lines_unit_snapshot_check;
alter table public.sale_lines add constraint sale_lines_unit_snapshot_check
  check (unit_snapshot in ('kg', 'g', 'dozen', 'piece', 'bundle', 'litre', 'ml'));

-- migrate:down
-- Refuses to run while any product or sale line uses `ml` (the old check would fail): those rows
-- must be changed first, and sale lines are append-only, so in practice this is up-only once used.
alter table public.sale_lines drop constraint sale_lines_unit_snapshot_check;
alter table public.sale_lines add constraint sale_lines_unit_snapshot_check
  check (unit_snapshot in ('kg', 'g', 'dozen', 'piece', 'bundle', 'litre'));

alter table public.products drop constraint products_unit_check;
alter table public.products add constraint products_unit_check
  check (unit in ('kg', 'g', 'dozen', 'piece', 'bundle', 'litre'));
