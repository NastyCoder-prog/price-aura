-- schema.sql
-- Paste this whole file into Supabase → SQL Editor → Run (once).
-- It creates the three tables the backend needs.

create table if not exists products (
  id bigint generated always as identity primary key,
  url text not null unique,
  title text not null,
  store text not null,
  image text,
  price_value integer not null,
  target_value integer not null,
  status text not null default 'Monitoring',
  last_change text,
  scanned_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists price_history (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  price_value integer not null,
  checked_at timestamptz not null
);

create table if not exists product_emails (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  email text not null,
  unique (product_id, email)
);

create index if not exists price_history_product_idx on price_history (product_id, id desc);
