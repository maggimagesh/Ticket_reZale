-- Tickets marketplace — related to the posting user.
-- Run after users table exists (or together with schema.sql).

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
