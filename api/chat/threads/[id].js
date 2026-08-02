import { sendError } from '../../_lib/http.js';
import threadDetail from '../../_lib/routes/thread-detail.js';
import imageItem from '../../_lib/routes/thread-image-item.js';
import images from '../../_lib/routes/thread-images.js';
import messageItem from '../../_lib/routes/thread-message-item.js';
import messages from '../../_lib/routes/thread-messages.js';
import typing from '../../_lib/routes/thread-typing.js';

/**
 * Everything for one thread: /api/chat/threads/:id[?section=&messageId=]
 *
 * Sub-resources are selected by query string rather than by path because
 * Vercel's zero-config /api routing only resolves a single dynamic segment.
 * Nested paths (/:id/messages) and catch-alls ([...rest], [[...path]]) both
 * return the platform's own 404 there, so the one shape that works reliably
 * is a single [id] file. Handlers live in _lib/routes and are unchanged.
 *
 *   (no section)                     → thread detail, confirm, close
 *   section=messages                 → list, send, mark read
 *   section=messages & messageId     → edit, delete
 *   section=typing                   → typing indicator
 *   section=images                   → sign upload, commit
 *   section=images   & messageId     → stream the file
 */
function queryFrom(req) {
  const host = req.headers?.host || 'localhost';
  try {
    const url = new URL(req.url || '/', `http://${host}`);
    return {
      section: url.searchParams.get('section') || '',
      messageId: url.searchParams.get('messageId') || '',
    };
  } catch {
    return { section: '', messageId: '' };
  }
}

function threadIdFrom(req) {
  const id = req.params?.id ?? req.query?.id;
  if (id) return Array.isArray(id) ? id[0] : id;
  const host = req.headers?.host || 'localhost';
  try {
    return new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean)[3] || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const id = threadIdFrom(req);
  if (!id) return sendError(res, 400, 'Thread id required');

  const { section, messageId } = queryFrom(req);
  req.params = { ...(req.params || {}), id, messageId: messageId || undefined };

  if (!section) return threadDetail(req, res);
  if (section === 'messages') return messageId ? messageItem(req, res) : messages(req, res);
  if (section === 'images') return messageId ? imageItem(req, res) : images(req, res);
  if (section === 'typing' && !messageId) return typing(req, res);

  return sendError(res, 404, 'Unknown chat section');
}
