import { getAuthUser } from '../../../_lib/auth-request.js';
import { assertThreadAccess } from '../../../_lib/chat-access.js';
import { allowMethods, readJson, sendError, sendJson } from '../../../_lib/http.js';
import { getSupabase } from '../../../_lib/supabase.js';

const TYPING_TTL_MS = 4000;

function threadIdFrom(req) {
  if (req.params?.id) return req.params.id;
  if (req.query?.id) return Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const host = req.headers?.host || 'localhost';
  try {
    return new URL(req.url || '/', `http://${host}`).pathname.split('/')[4] || null;
  } catch {
    return null;
  }
}

function isFresh(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < TYPING_TTL_MS;
}

/**
 * GET  /api/chat/threads/:id/typing — { peerTyping }
 * POST /api/chat/threads/:id/typing — { typing: true|false }
 */
export default async function handler(req, res) {
  const method = (req.method || '').toUpperCase();
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  const threadId = threadIdFrom(req);
  if (!threadId) return sendError(res, 400, 'Thread id required');

  try {
    const supabase = getSupabase();
    const access = await assertThreadAccess(supabase, threadId, user.id, {
      select: 'id, buyer_id, seller_id, buyer_typing_at, seller_typing_at',
    });
    if (!access.ok) return sendError(res, access.status, access.error);
    const thread = access.thread;

    const iAmBuyer = thread.buyer_id === user.id;
    const peerTypingAt = iAmBuyer ? thread.seller_typing_at : thread.buyer_typing_at;

    if (method === 'GET') {
      return sendJson(res, 200, { peerTyping: isFresh(peerTypingAt) });
    }

    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    const typing = !!body.typing;
    const col = iAmBuyer ? 'buyer_typing_at' : 'seller_typing_at';
    const { error: updErr } = await supabase
      .from('chat_threads')
      .update({ [col]: typing ? new Date().toISOString() : null })
      .eq('id', threadId);

    if (updErr) {
      console.error('[chat/typing]', updErr);
      return sendError(res, 500, 'Could not update typing state');
    }

    return sendJson(res, 200, { ok: true, typing });
  } catch (err) {
    console.error('[chat/typing]', err);
    return sendError(res, 500, 'Chat request failed');
  }
}
