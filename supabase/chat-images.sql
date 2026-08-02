-- Chat images + 48h retention metadata.
-- Run in Supabase SQL editor (or via migration script).

alter table public.chat_messages
  add column if not exists kind text not null default 'text'
    check (kind in ('text', 'image')),
  add column if not exists image_path text,
  add column if not exists image_mime text,
  add column if not exists image_bytes integer,
  add column if not exists image_name text;

comment on column public.chat_messages.kind is 'text = E2E body; image = file in Storage + encrypted caption';
comment on column public.chat_messages.image_path is 'Storage object path in chat-images bucket';

-- Private bucket for chat images (service role uploads/downloads via API).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = false;

-- No direct client access — all traffic goes through the Vercel API with JWT.
drop policy if exists "chat_images_no_anon" on storage.objects;
create policy "chat_images_no_anon"
  on storage.objects for all
  using (bucket_id = 'chat-images' and false)
  with check (bucket_id = 'chat-images' and false);
