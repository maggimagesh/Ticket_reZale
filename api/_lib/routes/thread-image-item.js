import { getAuthUser } from '../auth-request.js';
import { assertThreadAccess } from '../chat-access.js';
import { isThreadExpired, purgeExpiredChats } from '../chat-expiry.js';
import { allowMethods, sendError } from '../http.js';
import { getSupabase } from '../supabase.js';

function idsFrom(req) {
  if (req.params?.id && req.params?.messageId) {
    return { threadId: req.params.id, messageId: req.params.messageId };
  }
  const host = req.headers?.host || 'localhost';
  try {
    const parts = new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean);
    // /api/chat/threads/:id/images/:messageId
    return { threadId: parts[3] || null, messageId: parts[5] || null };
  } catch {
    return { threadId: null, messageId: null };
  }
}

/**
 * GET /api/chat/threads/:id/images/:messageId
 * Streams the image for view/download (auth + thread membership required).
 * ?download=1 → Content-Disposition: attachment
 */
export default async function route(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  const { threadId, messageId } = idsFrom(req);
  if (!threadId || !messageId) return sendError(res, 400, 'Thread and message id required');

  try {
    const supabase = getSupabase();
    await purgeExpiredChats(supabase);

    const access = await assertThreadAccess(supabase, threadId, user.id);
    if (!access.ok) return sendError(res, access.status, access.error);

    if (isThreadExpired(access.thread.created_at)) {
      return sendError(res, 410, 'This chat expired after 48 hours and was removed');
    }

    const { data: row, error } = await supabase
      .from('chat_messages')
      .select('id, thread_id, kind, image_path, image_mime, image_name')
      .eq('id', messageId)
      .eq('thread_id', threadId)
      .maybeSingle();

    if (error) {
      console.error('[chat/image get]', error);
      return sendError(res, 500, 'Could not load image');
    }
    if (!row || row.kind !== 'image' || !row.image_path) {
      return sendError(res, 404, 'Image not found');
    }

    const { data: file, error: dlErr } = await supabase.storage
      .from('chat-images')
      .download(row.image_path);

    if (dlErr || !file) {
      console.error('[chat/image download]', dlErr);
      return sendError(res, 404, 'Image file missing');
    }

    const host = req.headers?.host || 'localhost';
    const wantDownload = new URL(req.url || '/', `http://${host}`).searchParams.get('download') === '1';
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = row.image_mime || 'application/octet-stream';
    const filename = row.image_name || 'ticket-image';

    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `${wantDownload ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
    );
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch (err) {
    console.error('[chat/image]', err);
    return sendError(res, 500, 'Could not download image');
  }
}
