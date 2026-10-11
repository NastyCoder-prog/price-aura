-- schema.sql
-- Paste this whole file into Supabase/Neon → SQL Editor → Run.
-- Safe to re-run: every statement is idempotent (fresh installs AND upgrades
-- from the original integer-price schema both work).

create table if not exists products (
  id bigint generated always as identity primary key,
  url text not null unique,
  title text not null,
  store text not null,
  image text,
  price_value numeric(14,2) not null,
  target_value numeric(14,2) not null,
  currency text not null default 'INR',
  offer_url text,
  status text not null default 'Monitoring',
  last_change text,
  scanned_at timestamptz,
  check_interval_hours integer not null default 6,
  created_at timestamptz not null default now()
);

create table if not exists price_history (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  price_value numeric(14,2) not null,
  checked_at timestamptz not null
);

create table if not exists product_emails (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  email text not null,
  unique (product_id, email)
);

-- Upgrades from the original schema (integer prices, no currency columns).
alter table products alter column price_value type numeric(14,2) using price_value::numeric(14,2);
alter table products alter column target_value type numeric(14,2) using target_value::numeric(14,2);
alter table price_history alter column price_value type numeric(14,2) using price_value::numeric(14,2);
alter table products add column if not exists currency text not null default 'INR';
alter table products add column if not exists offer_url text;
alter table products add column if not exists check_interval_hours integer not null default 6;

create index if not exists price_history_product_idx on price_history (product_id, id desc);
create index if not exists products_scanned_idx on products (scanned_at asc nulls first);
