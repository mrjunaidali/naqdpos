-- migrate:up
-- Shop profile and receipts (US014, US036; architecture §3 shops, §6).
-- receipt_language: en | ur | both; paper_width_mm: 58 | 80. Checks on the profile fields the
-- owner edits (name 1–80, address ≤ 200, receipt footer ≤ 200). Logo upload comes later.

-- Existing rows must satisfy the new checks.
update public.shops set name = left(trim(name), 80) where length(trim(name)) > 80;
update public.shops set address = left(address, 200) where length(address) > 200;
update public.shops set receipt_footer = left(receipt_footer, 200)
where length(receipt_footer) > 200;

alter table public.shops
  add column receipt_language text not null default 'en'
    constraint shops_receipt_language check (receipt_language in ('en', 'ur', 'both')),
  add column paper_width_mm integer not null default 58
    constraint shops_paper_width check (paper_width_mm in (58, 80)),
  add constraint shops_name_length check (length(trim(name)) between 1 and 80),
  add constraint shops_address_length check (address is null or length(address) <= 200),
  add constraint shops_footer_length check (receipt_footer is null or length(receipt_footer) <= 200);

grant update (receipt_language, paper_width_mm) on public.shops to naqdpos_app;
update public.sync_tables
set push_columns = push_columns || array['receipt_language', 'paper_width_mm']
where table_name = 'shops';
-- Touch every shop once so devices that already hold the row pull the new columns.
update public.shops set updated_at = updated_at;

-- migrate:down
update public.sync_tables
set push_columns = array_remove(array_remove(push_columns, 'receipt_language'), 'paper_width_mm')
where table_name = 'shops';
alter table public.shops
  drop constraint shops_footer_length,
  drop constraint shops_address_length,
  drop constraint shops_name_length,
  drop column paper_width_mm,
  drop column receipt_language;
