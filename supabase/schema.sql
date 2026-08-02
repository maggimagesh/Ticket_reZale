-- Tickets reZale — auth + tickets schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query).

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  constraint users_username_len check (char_length(username) >= 3),
  constraint users_username_format check (username ~ '^[a-z0-9._]+$')
);

create unique index if not exists users_username_unique
  on public.users (lower(username));

alter table public.users enable row level security;

comment on table public.users is 'Marketplace accounts; passwords stored as bcrypt hashes.';

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.users (id) on delete cascade,
  movie text not null,
  theatre text not null,
  show_time timestamptz not null,
  price integer not null check (price > 0),
  qty integer not null check (qty >= 1 and qty <= 10),
  seat text not null default 'Regular',
  note text not null default '',
  status text not null default 'live' check (status in ('live', 'sold', 'withdrawn')),
  created_at timestamptz not null default now(),
  constraint tickets_movie_len check (char_length(trim(movie)) >= 1),
  constraint tickets_theatre_len check (char_length(trim(theatre)) >= 1)
);

create index if not exists tickets_status_created_idx
  on public.tickets (status, created_at desc);

create index if not exists tickets_seller_id_idx
  on public.tickets (seller_id);

alter table public.tickets enable row level security;

comment on table public.tickets is 'Ticket listings posted by users; accessed via Vercel API with service role.';

-- See also supabase/theatres.sql (seeded cinemas within ~50 km of Chennai Central).
create table if not exists public.theatres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null default '',
  distance_km numeric(5,1),
  created_at timestamptz not null default now(),
  constraint theatres_name_len check (char_length(trim(name)) >= 2)
);

alter table public.theatres
  add column if not exists distance_km numeric(5,1);

alter table public.theatres
  add column if not exists seat_types text[] not null default array['Regular']::text[];

create unique index if not exists theatres_name_unique
  on public.theatres (lower(name));

alter table public.theatres enable row level security;

comment on table public.theatres is
  'Cinemas within ~50 km of Chennai Central; seat_types drive the sell-form dropdown.';

create table if not exists public.movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer not null,
  title text not null,
  original_title text not null default '',
  release_date date,
  popularity real not null default 0,
  poster_path text,
  synced_at timestamptz not null default now(),
  constraint movies_title_len check (char_length(trim(title)) >= 1)
);

create unique index if not exists movies_tmdb_id_unique on public.movies (tmdb_id);
create index if not exists movies_popularity_idx on public.movies (popularity desc);
create index if not exists movies_title_lower_idx on public.movies (lower(title));

alter table public.movies enable row level security;

comment on table public.movies is
  'Now-playing / upcoming / searched titles from TMDB for sell-form suggestions.';
