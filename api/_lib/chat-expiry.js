/** Chat retention: threads + attached images expire after 48 hours. */

/**
 * Master switch for the 48-hour chat retention feature.
 *
 * Currently OFF. Vercel Hobby plans only allow cron jobs that run once per
 * day, so the hourly `/api/chat/cleanup` schedule failed at deploy time. The
 * cron entry has been removed from vercel.json to match.
 *
 * Retention also ran lazily on every chat API request, so disabling the cron
 * alone would have left chats disappearing at 48 hours with nothing sweeping
 * up their Storage objects. This flag turns off both paths together.
 *
 * To re-enable: set this to true and add the cron back to vercel.json. On
 * Hobby use a daily schedule, e.g. { "path": "/api/chat/cleanup",
 * "schedule": "0 3 * * *" }; Pro allows the original hourly "0 * * * *".
 */
export const CHAT_RETENTION_ENABLED = false;

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

/** Null while retention is off, so clients show no expiry countdown. */
export function threadExpiresAt(createdAt) {
  if (!CHAT_RETENTION_ENABLED) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + CHAT_TTL_MS).toISOString();
}

export function isThreadExpired(createdAt, now = Date.now()) {
  if (!CHAT_RETENTION_ENABLED) return false;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t >= CHAT_TTL_MS;
}

/**
 * Delete threads older than 48h and remove their Storage images.
 * Safe to call often (lazy purge on chat API hits).
 */
export async function purgeExpiredChats(supabase) {
  if (!CHAT_RETENTION_ENABLED) return { deleted: 0, skipped: true };

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
