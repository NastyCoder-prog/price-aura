-- schema.sql
-- Paste this whole file into Supabase/Neon → SQL Editor → Run.
-- Safe to re-run: every statement is idempotent (fresh installs AND upgrades
-- from the original integer-price schema both work).

create table if not exists users (
  id bigint generated always as identity primary key,
  email text not null unique,
  password_hash text not null,
  name text,
  created_at timestamptz not null default now()
);

-- Sessions store only a HASH of the cookie token (see lib/auth.ts).
create table if not exists sessions (
  token_hash text primary key,
  user_id bigint not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

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
  user_id bigint references users(id) on delete cascade,
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

-- Accounts: a product's URL is unique PER OWNER, not globally, so two people
-- can watch the same product. Older databases had a global unique on url —
-- drop it and replace with the per-user index.
alter table products add column if not exists user_id bigint references users(id) on delete cascade;
alter table products drop constraint if exists products_url_key;
create unique index if not exists products_user_url_idx on products (user_id, url);
create index if not exists products_user_idx on products (user_id, id desc);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

create index if not exists price_history_product_idx on price_history (product_id, id desc);
create index if not exists products_scanned_idx on products (scanned_at asc nulls first);
