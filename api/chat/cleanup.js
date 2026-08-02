import { timingSafeEqual } from 'crypto';
import { purgeExpiredChats } from '../_lib/chat-expiry.js';
import { allowMethods, sendError, sendJson } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

/**
 * POST /api/chat/cleanup — purge chats + images older than 48 hours.
 * Also run lazily from chat list/message endpoints.
 * Optional Vercel Cron: Authorization Bearer CRON_SECRET
 */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST', 'GET'])) return;

  // Fail closed: an unset secret must disable this endpoint, not unlock it.
  // Expired chats are still purged lazily by the chat list/message/image
  // handlers, so retention keeps working either way.
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
