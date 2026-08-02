-- WhatsApp-style message actions: edit, delete for me, delete for everyone.
-- Run in the Supabase SQL editor after chat.sql / chat-images.sql.

alter table public.chat_messages
  -- Bumped on every edit/delete so the client poll can pick up changes to
  -- messages it already has. Without this an edit to an older message would
  -- never reach the peer, because the poll cursor tracks created_at.
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists edited_at timestamptz,
  -- Set when the sender deletes for everyone. Row is kept as a tombstone.
  add column if not exists deleted_at timestamptz,
  -- Per-user "delete for me". Server appends the caller's id; never client-set.
  add column if not exists deleted_for uuid[] not null default '{}';

comment on column public.chat_messages.updated_at is 'Sync cursor — bumped on edit/delete';
comment on column public.chat_messages.edited_at is 'Last edit time; drives the "edited" label';
comment on column public.chat_messages.deleted_at is 'Deleted for everyone — ciphertext cleared, row kept as tombstone';
comment on column public.chat_messages.deleted_for is 'User ids that hid this message for themselves only';

create index if not exists chat_messages_thread_updated_idx
  on public.chat_messages (thread_id, updated_at asc);
