import { getAuthUser } from '../../../_lib/auth-request.js';
import { assertThreadAccess } from '../../../_lib/chat-access.js';
import { isThreadExpired, purgeExpiredChats } from '../../../_lib/chat-expiry.js';
import { allowMethods, readJson, sendError, sendJson } from '../../../_lib/http.js';
import { getSupabase } from '../../../_lib/supabase.js';

const MSG_SELECT =
  'id, sender_id, ciphertext, iv, created_at, updated_at, read_at, kind, ' +
  'image_path, image_mime, image_bytes, image_name, edited_at, deleted_at, deleted_for';

function threadIdFrom(req) {
  if (req.params?.id) return req.params.id;
  if (req.query?.id) return Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const host = req.headers?.host || 'localhost';
  try {
    const url = new URL(req.url || '/', `http://${host}`);
    return url.searchParams.get('threadId') || url.pathname.split('/')[4] || null;
  } catch {
    return null;
  }
}

function shapeMessage(m, userId) {
  const kind = m.kind || 'text';
  const deletedForAll = !!m.deleted_at;
  const hiddenForMe = (m.deleted_for || []).includes(userId);
  return {
    id: m.id,
    senderId: m.sender_id,
    from: m.sender_id === userId ? 'me' : 'them',
    ciphertext: deletedForAll ? null : m.ciphertext,
    iv: deletedForAll ? null : m.iv,
    at: new Date(m.created_at).getTime(),
    // Sync cursor: bumped by edits/deletes, unlike `at`
    syncAt: new Date(m.updated_at || m.created_at).getTime(),
    read: !!m.read_at,
    text: null,
    kind,
    hasImage: !deletedForAll && kind === 'image' && !!m.image_path,
    imageMime: deletedForAll ? null : m.image_mime || null,
    imageBytes: deletedForAll ? null : m.image_bytes || null,
    imageName: deletedForAll ? null : m.image_name || null,
    editedAt: m.edited_at ? new Date(m.edited_at).getTime() : null,
    // 'all' → tombstone both parties see; 'me' → caller hid it locally
    deleted: deletedForAll ? 'all' : hiddenForMe ? 'me' : null,
  };
}

/**
 * GET  /api/chat/threads/:id/messages — ciphertext only (+ image metadata)
 * POST /api/chat/threads/:id/messages — { ciphertext, iv }
 * PATCH — mark peer messages read { read: true }
 */
export default async function handler(req, res) {
  const method = (req.method || '').toUpperCase();
  if (!allowMethods(req, res, ['GET', 'POST', 'PATCH'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  const threadId = threadIdFrom(req);
  if (!threadId) return sendError(res, 400, 'Thread id required');

  try {
    const supabase = getSupabase();
    await purgeExpiredChats(supabase);

    const access = await assertThreadAccess(supabase, threadId, user.id);
    if (!access.ok) return sendError(res, access.status, access.error);
    const thread = access.thread;

    if (isThreadExpired(thread.created_at)) {
      return sendError(res, 410, 'This chat expired after 48 hours and was removed');
    }

    if (method === 'GET') {
      const host = req.headers?.host || 'localhost';
      const url = new URL(req.url || '/', `http://${host}`);
      const afterRaw = url.searchParams.get('after');
      const afterMs = afterRaw ? Number(afterRaw) : NaN;

      let query = supabase
        .from('chat_messages')
        .select(MSG_SELECT)
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      // Cursor runs on updated_at so edits and deletes to already-delivered
      // messages reach the peer; ordering still uses created_at.
      const MAX_TS = 8.64e15; // ECMAScript maximum time value
      if (Number.isFinite(afterMs) && afterMs > 0 && afterMs <= MAX_TS) {
        query = query.gt('updated_at', new Date(afterMs).toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('[chat/messages list]', error);
        return sendError(res, 500, 'Could not load messages');
      }

      return sendJson(
        res,
        200,
        (data || []).map((m) => shapeMessage(m, user.id)),
      );
    }

    if (method === 'PATCH') {
      const { error } = await supabase
        .from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .neq('sender_id', user.id)
        .is('read_at', null);

      if (error) {
        console.error('[chat/messages read]', error);
        return sendError(res, 500, 'Could not update read state');
      }
      return sendJson(res, 200, { ok: true });
    }

    if (thread.status === 'closed') {
      return sendError(res, 400, 'This conversation is closed');
    }

    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    const ciphertext = String(body.ciphertext || '').trim();
    const iv = String(body.iv || '').trim();
    if (!ciphertext || !iv) return sendError(res, 400, 'ciphertext and iv are required');

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        thread_id: threadId,
        sender_id: user.id,
        ciphertext,
        iv,
        kind: 'text',
      })
      .select(MSG_SELECT)
      .single();

    if (error) {
      console.error('[chat/messages post]', error);
      return sendError(res, 500, 'Could not send message');
    }

    await supabase
      .from('chat_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', threadId);

    return sendJson(res, 201, shapeMessage(data, user.id));
  } catch (err) {
    console.error('[chat/messages]', err);
    return sendError(res, 500, 'Chat request failed');
  }
}
