/** Chat retention: threads + attached images expire after 48 hours. */

const CHAT_TTL_MS = 48 * 60 * 60 * 1000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export function threadExpiresAt(createdAt) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + CHAT_TTL_MS).toISOString();
}

export function isThreadExpired(createdAt, now = Date.now()) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t >= CHAT_TTL_MS;
}

/**
 * Delete threads older than 48h and remove their Storage images.
 * Safe to call often (lazy purge on chat API hits).
 */
export async function purgeExpiredChats(supabase) {
  const cutoff = new Date(Date.now() - CHAT_TTL_MS).toISOString();

  const { data: expired, error } = await supabase
    .from('chat_threads')
    .select('id')
    .lt('created_at', cutoff)
    .limit(100);

  if (error) {
    console.error('[chat purge list]', error);
    return { deleted: 0 };
  }
  if (!expired?.length) return { deleted: 0 };

  const ids = expired.map((r) => r.id);

  const { data: images } = await supabase
    .from('chat_messages')
    .select('image_path')
    .in('thread_id', ids)
    .eq('kind', 'image')
    .not('image_path', 'is', null);

  const paths = (images || []).map((r) => r.image_path).filter(Boolean);
  if (paths.length) {
    const { error: storageErr } = await supabase.storage.from('chat-images').remove(paths);
    if (storageErr) console.error('[chat purge storage]', storageErr);
  }

  const { error: delErr } = await supabase.from('chat_threads').delete().in('id', ids);
  if (delErr) {
    console.error('[chat purge delete]', delErr);
    return { deleted: 0 };
  }

  return { deleted: ids.length };
}

export function assertImageUpload({ mime, bytes, name }) {
  const type = String(mime || '').toLowerCase().trim();
  if (!ALLOWED_IMAGE_MIMES.has(type)) {
    return { error: 'Only JPEG, PNG, WebP, or GIF images are allowed' };
  }
  const size = Number(bytes) || 0;
  if (size < 1) return { error: 'Empty file' };
  if (size > MAX_IMAGE_BYTES) {
    return { error: 'Image must be under 5 MB' };
  }
  const safeName = String(name || 'image')
    .replace(/[^\w.\- ()]/g, '_')
    .slice(0, 120);
  return { mime: type === 'image/jpg' ? 'image/jpeg' : type, bytes: size, name: safeName || 'image' };
}
