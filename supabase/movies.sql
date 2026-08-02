-- Cached movie titles from TMDB (refreshed ~daily). Movies change weekly;
-- theatres stay static. Search uses title + original_title.

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
