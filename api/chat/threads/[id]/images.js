import { randomUUID } from 'crypto';
import { getAuthUser } from '../../../_lib/auth-request.js';
import { assertThreadAccess } from '../../../_lib/chat-access.js';
import {
  assertImageUpload,
  isThreadExpired,
  MAX_IMAGE_BYTES,
  purgeExpiredChats,
} from '../../../_lib/chat-expiry.js';
import { allowMethods, readJson, sendError, sendJson } from '../../../_lib/http.js';
import { getSupabase } from '../../../_lib/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function threadIdFrom(req) {
  if (req.params?.id) return req.params.id;
  if (req.query?.id) return Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const host = req.headers?.host || 'localhost';
  try {
    const parts = new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean);
    return parts[3] || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/chat/threads/:id/images
 *
 * Step A — { intent: 'sign', mime, name, bytes } → signed upload URL (direct to Storage)
 * Step B — { intent: 'commit', path, mime, name, bytes, ciphertext, iv } → chat message row
 *
 * Direct Storage upload avoids Vercel’s ~4.5MB body limit for 5MB images.
 */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

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
    if (thread.status === 'closed') {
      return sendError(res, 400, 'This conversation is closed');
    }

    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    const intent = String(body.intent || 'commit').trim();

    if (intent === 'sign') {
      const checked = assertImageUpload({
        mime: body.mime,
        bytes: body.bytes,
        name: body.name,
      });
      if (checked.error) return sendError(res, 400, checked.error);

      const messageId = randomUUID();
      const ext =
        checked.mime === 'image/png'
          ? 'png'
          : checked.mime === 'image/webp'
            ? 'webp'
            : checked.mime === 'image/gif'
              ? 'gif'
              : 'jpg';
      const path = `${threadId}/${messageId}.${ext}`;

      const { data, error } = await supabase.storage
        .from('chat-images')
        .createSignedUploadUrl(path);

      if (error || !data?.signedUrl) {
        console.error('[chat/images sign]', error);
        // Ensure bucket exists then retry once
        await supabase.storage.createBucket('chat-images', {
          public: false,
          fileSizeLimit: MAX_IMAGE_BYTES,
          allowedMimeTypes: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'image/heic',
            'image/heif',
          ],
        });
        const retry = await supabase.storage.from('chat-images').createSignedUploadUrl(path);
        if (retry.error || !retry.data?.signedUrl) {
          return sendError(res, 500, 'Could not prepare image upload');
        }
        return sendJson(res, 200, {
          messageId,
          path,
          token: retry.data.token,
          signedUrl: retry.data.signedUrl,
          mime: checked.mime,
          name: checked.name,
          bytes: checked.bytes,
        });
      }

      return sendJson(res, 200, {
        messageId,
        path,
        token: data.token,
        signedUrl: data.signedUrl,
        mime: checked.mime,
        name: checked.name,
        bytes: checked.bytes,
      });
    }

    // commit
    const ciphertext = String(body.ciphertext || '').trim();
    const iv = String(body.iv || '').trim();
    if (!ciphertext || !iv) return sendError(res, 400, 'Encrypted caption required');

    const path = String(body.path || '').trim();
    // Exact shape check, not a prefix test: `<threadId>/<uuid>.<ext>` only, so
    // no traversal segment can point the write or the cleanup at another thread.
    const segments = path.split('/');
    if (segments.length !== 2 || segments[0] !== threadId || segments[1].includes('..')) {
      return sendError(res, 400, 'Invalid image path');
    }

    const checked = assertImageUpload({
      mime: body.mime,
      bytes: body.bytes,
      name: body.name,
    });
    if (checked.error) return sendError(res, 400, checked.error);

    // Derive the row id from the path we signed. Accepting a client-named
    // primary key lets a caller force an insert error on purpose.
    const messageId = segments[1].split('.')[0] || '';
    if (!UUID_RE.test(messageId)) {
      return sendError(res, 400, 'Invalid image path');
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        id: messageId,
        thread_id: threadId,
        sender_id: user.id,
        ciphertext,
        iv,
        kind: 'image',
        image_path: path,
        image_mime: checked.mime,
        image_bytes: checked.bytes,
        image_name: checked.name,
      })
      .select(
        'id, sender_id, ciphertext, iv, created_at, updated_at, read_at, kind, image_path, image_mime, image_bytes, image_name',
      )
      .single();

    if (error) {
      console.error('[chat/images commit]', error);
      // Remove the object only if it is a genuine orphan. If a message row
      // already references it, this insert lost a race or collided and the
      // file belongs to that row.
      const { data: referenced } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('image_path', path)
        .maybeSingle();
      if (!referenced) {
        await supabase.storage.from('chat-images').remove([path]);
      }
      return sendError(res, 500, 'Could not send image');
    }

    await supabase
      .from('chat_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', threadId);

    return sendJson(res, 201, {
      id: data.id,
      senderId: data.sender_id,
      from: 'me',
      ciphertext: data.ciphertext,
      iv: data.iv,
      at: new Date(data.created_at).getTime(),
      syncAt: new Date(data.updated_at || data.created_at).getTime(),
      editedAt: null,
      deleted: null,
      read: false,
      text: null,
      kind: 'image',
      imageMime: data.image_mime,
      imageBytes: data.image_bytes,
      imageName: data.image_name,
      hasImage: true,
    });
  } catch (err) {
    console.error('[chat/images]', err);
    return sendError(res, 500, 'Image upload failed');
  }
}
