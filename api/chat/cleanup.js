import { timingSafeEqual } from 'crypto';
import { CHAT_RETENTION_ENABLED, purgeExpiredChats } from '../_lib/chat-expiry.js';
import { allowMethods, sendError, sendJson } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

/**
 * POST /api/chat/cleanup — purge chats + images older than 48 hours.
 *
 * Dormant while CHAT_RETENTION_ENABLED is false. The route is kept so that
 * re-enabling retention needs only the flag and a cron entry in vercel.json.
 * Vercel Cron authenticates with Authorization: Bearer CRON_SECRET.
 */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST', 'GET'])) return;

  if (!CHAT_RETENTION_ENABLED) {
    return sendJson(res, 200, { ok: true, deleted: 0, retention: 'disabled' });
  }

  // Fail closed: an unset secret must disable this endpoint, not unlock it.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/cleanup] CRON_SECRET is not set — endpoint disabled');
    return sendError(res, 503, 'Cleanup is not configured');
  }

  const auth = String(req.headers?.authorization || '');
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(expected);
  const ok = authBuf.length === expectedBuf.length && timingSafeEqual(authBuf, expectedBuf);
  if (!ok) {
    return sendError(res, 401, 'Unauthorized');
  }

  try {
    const supabase = getSupabase();
    const result = await purgeExpiredChats(supabase);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('[chat/cleanup]', err);
    return sendError(res, 500, 'Cleanup failed');
  }
}
