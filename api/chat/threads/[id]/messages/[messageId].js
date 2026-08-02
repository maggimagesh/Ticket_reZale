import { getAuthUser } from '../../../../_lib/auth-request.js';
import { assertThreadAccess } from '../../../../_lib/chat-access.js';
import { isThreadExpired } from '../../../../_lib/chat-expiry.js';
import { allowMethods, readJson, sendError, sendJson } from '../../../../_lib/http.js';
import { getSupabase } from '../../../../_lib/supabase.js';

const MSG_SELECT =
  'id, thread_id, sender_id, ciphertext, iv, created_at, updated_at, read_at, kind, ' +
  'image_path, image_mime, image_bytes, image_name, edited_at, deleted_at, deleted_for';

/** WhatsApp allows edits for 15 minutes after sending. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

function idsFrom(req) {
  if (req.params?.id && req.params?.messageId) {
    return { threadId: req.params.id, messageId: req.params.messageId };
  }
  if (req.query?.id && req.query?.messageId) {
    return { threadId: req.query.id, messageId: req.query.messageId };
  }
  const host = req.headers?.host || 'localhost';
  try {
    const parts = new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean);
    // /api/chat/threads/:id/messages/:messageId
    return { threadId: parts[3] || null, messageId: parts[5] || null };
  } catch {
    return { threadId: null, messageId: null };
  }
}

function shape(m, userId) {
  const deletedForAll = !!m.deleted_at;
  const hiddenForMe = (m.deleted_for || []).includes(userId);
  return {
    id: m.id,
    senderId: m.sender_id,
    from: m.sender_id === userId ? 'me' : 'them',
    ciphertext: deletedForAll ? null : m.ciphertext,
    iv: deletedForAll ? null : m.iv,
    at: new Date(m.created_at).getTime(),
    syncAt: new Date(m.updated_at || m.created_at).getTime(),
    read: !!m.read_at,
    text: null,
    kind: m.kind || 'text',
    hasImage: !deletedForAll && m.kind === 'image' && !!m.image_path,
    imageMime: deletedForAll ? null : m.image_mime || null,
    imageBytes: deletedForAll ? null : m.image_bytes || null,
    imageName: deletedForAll ? null : m.image_name || null,
    editedAt: m.edited_at ? new Date(m.edited_at).getTime() : null,
    deleted: deletedForAll ? 'all' : hiddenForMe ? 'me' : null,
  };
}

/**
 * PATCH  /api/chat/threads/:id/messages/:messageId — edit body { ciphertext, iv }
 * DELETE /api/chat/threads/:id/messages/:messageId?scope=me|all
 *
 * scope=me  — hides the message for the caller only (either party, any message)
 * scope=all — sender only; leaves a tombstone both parties can see
 */
export default async function handler(req, res) {
  const method = (req.method || '').toUpperCase();
  if (!allowMethods(req, res, ['PATCH', 'DELETE'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  const { threadId, messageId } = idsFrom(req);
  if (!threadId || !messageId) return sendError(res, 400, 'Thread and message id required');

  try {
    const supabase = getSupabase();

    const access = await assertThreadAccess(supabase, threadId, user.id);
    if (!access.ok) return sendError(res, access.status, access.error);
    if (isThreadExpired(access.thread.created_at)) {
      return sendError(res, 410, 'This chat expired after 48 hours and was removed');
    }

    // Scope the lookup to the thread so a message id from another
    // conversation cannot be reached through this URL.
    const { data: message, error: lookupErr } = await supabase
      .from('chat_messages')
      .select(MSG_SELECT)
      .eq('id', messageId)
      .eq('thread_id', threadId)
      .maybeSingle();

    if (lookupErr) {
      console.error('[chat/message lookup]', { code: lookupErr.code, message: lookupErr.message });
      return sendError(res, 500, 'Could not load message');
    }
    if (!message) return sendError(res, 404, 'Message not found');

    if (method === 'DELETE') {
      return await removeMessage(req, res, supabase, message, user);
    }
    return await editMessage(req, res, supabase, message, user);
  } catch (err) {
    console.error('[chat/message]', err);
    return sendError(res, 500, 'Could not update message');
  }
}

async function editMessage(req, res, supabase, message, user) {
  if (message.sender_id !== user.id) {
    return sendError(res, 403, 'You can only edit your own messages');
  }
  if (message.deleted_at) {
    return sendError(res, 400, 'This message was deleted');
  }
  if ((message.kind || 'text') !== 'text') {
    return sendError(res, 400, 'Only text messages can be edited');
  }
  if (Date.now() - new Date(message.created_at).getTime() > EDIT_WINDOW_MS) {
    return sendError(res, 400, 'Messages can only be edited for 15 minutes after sending');
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

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('chat_messages')
    .update({ ciphertext, iv, edited_at: now, updated_at: now })
    .eq('id', message.id)
    .eq('sender_id', user.id) // re-assert ownership in the predicate
    .is('deleted_at', null)
    .select(MSG_SELECT)
    .maybeSingle();

  if (error) {
    console.error('[chat/message edit]', { code: error.code, message: error.message });
    return sendError(res, 500, 'Could not edit message');
  }
  if (!updated) return sendError(res, 409, 'Message changed — reload the chat');

  return sendJson(res, 200, shape(updated, user.id));
}

async function removeMessage(req, res, supabase, message, user) {
  const host = req.headers?.host || 'localhost';
  let scope = 'me';
  try {
    scope = new URL(req.url || '/', `http://${host}`).searchParams.get('scope') || 'me';
  } catch {
    /* default to the safe, local-only scope */
  }

  const now = new Date().toISOString();

  if (scope === 'all') {
    if (message.sender_id !== user.id) {
      return sendError(res, 403, 'You can only delete your own messages for everyone');
    }
    if (message.deleted_at) {
      return sendJson(res, 200, shape(message, user.id));
    }

    // Tombstone: drop the ciphertext and every trace of the attachment.
    const { data: updated, error } = await supabase
      .from('chat_messages')
      .update({
        ciphertext: '',
        iv: '',
        image_path: null,
        image_mime: null,
        image_bytes: null,
        image_name: null,
        deleted_at: now,
        updated_at: now,
      })
      .eq('id', message.id)
      .eq('sender_id', user.id)
      .select(MSG_SELECT)
      .maybeSingle();

    if (error) {
      console.error('[chat/message delete all]', { code: error.code, message: error.message });
      return sendError(res, 500, 'Could not delete message');
    }
    if (!updated) return sendError(res, 409, 'Message changed — reload the chat');

    // Best-effort: the row is already a tombstone, so a failure here only
    // leaves an orphaned object for the 48h purge to collect.
    if (message.kind === 'image' && message.image_path) {
      const { error: storageErr } = await supabase.storage
        .from('chat-images')
        .remove([message.image_path]);
      if (storageErr) console.error('[chat/message delete storage]', storageErr.message);
    }

    return sendJson(res, 200, shape(updated, user.id));
  }

  // scope=me — hide for the caller only. The id is taken from the verified
  // token, never from the request body.
  const alreadyHidden = (message.deleted_for || []).includes(user.id);
  if (alreadyHidden) return sendJson(res, 200, shape(message, user.id));

  const { data: updated, error } = await supabase
    .from('chat_messages')
    .update({ deleted_for: [...(message.deleted_for || []), user.id], updated_at: now })
    .eq('id', message.id)
    .select(MSG_SELECT)
    .maybeSingle();

  if (error) {
    console.error('[chat/message delete me]', { code: error.code, message: error.message });
    return sendError(res, 500, 'Could not delete message');
  }
  if (!updated) return sendError(res, 409, 'Message changed — reload the chat');

  return sendJson(res, 200, shape(updated, user.id));
}
