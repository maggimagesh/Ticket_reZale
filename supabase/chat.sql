-- E2E encrypted buyer ↔ seller chat.
-- Server stores ciphertext + wrapped conversation keys only — never plaintext.

alter table public.users
  add column if not exists public_key text,
  add column if not exists enc_private_key text,
  add column if not exists key_salt text,
  add column if not exists key_iv text;

comment on column public.users.public_key is 'SPKI base64 ECDH P-256 public key for E2E chat';
comment on column public.users.enc_private_key is 'Private key JWK encrypted with password-derived AES-GCM';
comment on column public.users.key_salt is 'PBKDF2 salt (base64) for private-key unwrap';
comment on column public.users.key_iv is 'AES-GCM IV (base64) for private-key unwrap';

-- Soft-delete listings (status = withdrawn) instead of hard DELETE —
-- hard delete CASCADE-wipes chat_threads. App delete path must use withdrawn.
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.tickets (id) on delete cascade,
  buyer_id uuid not null references public.users (id) on delete cascade,
  seller_id uuid not null references public.users (id) on delete cascade,
  qty integer not null check (qty >= 1 and qty <= 10),
  status text not null default 'open' check (status in ('open', 'confirmed', 'closed')),
  -- JSON: { wrapped, iv, ephPub } — conversation AES key wrapped to each party
  buyer_wrapped_key text not null,
  seller_wrapped_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_threads_buyer_seller_diff check (buyer_id <> seller_id),
  constraint chat_threads_listing_buyer_unique unique (listing_id, buyer_id)
);

create index if not exists chat_threads_buyer_idx on public.chat_threads (buyer_id, updated_at desc);
create index if not exists chat_threads_seller_idx on public.chat_threads (seller_id, updated_at desc);

alter table public.chat_threads
  add column if not exists buyer_typing_at timestamptz,
  add column if not exists seller_typing_at timestamptz,
  add column if not exists buyer_confirmed_at timestamptz,
  add column if not exists seller_confirmed_at timestamptz;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists chat_messages_thread_idx
  on public.chat_messages (thread_id, created_at asc);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

comment on table public.chat_threads is 'Negotiation threads; message bodies are E2E ciphertext only.';
comment on table public.chat_messages is 'AES-GCM ciphertext; server cannot read contents.';
