import { sendError } from '../../_lib/http.js';
import threadDetail from '../../_lib/routes/thread-detail.js';
import imageItem from '../../_lib/routes/thread-image-item.js';
import images from '../../_lib/routes/thread-images.js';
import threadList from '../../_lib/routes/thread-list.js';
import messageItem from '../../_lib/routes/thread-message-item.js';
import messages from '../../_lib/routes/thread-messages.js';
import typing from '../../_lib/routes/thread-typing.js';

/**
 * Every /api/chat/threads route is served by this one function.
 *
 * Two reasons it is a single optional catch-all rather than a file per route:
 *
 *  1. Vercel's Hobby plan caps a deployment at 12 serverless functions.
 *  2. Splitting the subtree across `threads.js`, `[id].js` and a nested
 *     `[id]/[...rest].js` does not route reliably — Vercel matched one
 *     segment after the id (/messages, /typing) but returned its own 404 for
 *     two (/images/:messageId). With no sibling files there is nothing to
 *     shadow the deeper paths.
 *
 * Handlers themselves live in _lib/routes (underscore paths are not routed).
 *
 *   []                        → list / create threads
 *   [id]                      → thread detail, confirm, close
 *   [id, 'messages']          → list, send, mark read
 *   [id, 'messages', msgId]   → edit, delete
 *   [id, 'typing']            → typing indicator
 *   [id, 'images']            → sign upload, commit
 *   [id, 'images', msgId]     → stream the file
 */
function segmentsFrom(req) {
  const raw = req.query?.path ?? req.params?.path;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string' && raw) return raw.split('/').filter(Boolean);

  const host = req.headers?.host || 'localhost';
  try {
    const parts = new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean);
    return parts.slice(3); // strip api/chat/threads
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  const [id, section, item] = segmentsFrom(req);

  if (!id) return threadList(req, res);

  // Vercel does not populate req.params for catch-all segments, and the
  // handlers read both ids from there.
  req.params = { ...(req.params || {}), id, messageId: item };

  if (!section) return threadDetail(req, res);
  if (section === 'messages') return item ? messageItem(req, res) : messages(req, res);
  if (section === 'images') return item ? imageItem(req, res) : images(req, res);
  if (section === 'typing' && !item) return typing(req, res);

  return sendError(res, 404, 'Unknown chat route');
}
