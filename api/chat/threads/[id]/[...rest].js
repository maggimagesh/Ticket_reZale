import { sendError } from '../../../_lib/http.js';
import imageItem from '../../../_lib/routes/thread-image-item.js';
import images from '../../../_lib/routes/thread-images.js';
import messageItem from '../../../_lib/routes/thread-message-item.js';
import messages from '../../../_lib/routes/thread-messages.js';
import typing from '../../../_lib/routes/thread-typing.js';

/**
 * Single entry point for everything under /api/chat/threads/:id/*.
 *
 * These five endpoints share one serverless function because Vercel's Hobby
 * plan caps a deployment at 12 of them. Each handler still lives in its own
 * module under _lib/routes (underscore paths are not routed).
 *
 *   /messages            → list, send, mark read
 *   /messages/:messageId → edit, delete
 *   /typing              → typing indicator
 *   /images              → sign upload, commit
 *   /images/:messageId   → stream the file
 */
function segmentsFrom(req) {
  const rest = req.query?.rest ?? req.params?.rest;
  if (Array.isArray(rest)) return rest;
  if (typeof rest === 'string' && rest) return rest.split('/');

  const host = req.headers?.host || 'localhost';
  try {
    const parts = new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean);
    // /api/chat/threads/:id/<rest...>
    return parts.slice(4);
  } catch {
    return [];
  }
}

function threadIdFrom(req) {
  const id = req.query?.id ?? req.params?.id;
  if (id) return Array.isArray(id) ? id[0] : id;
  const host = req.headers?.host || 'localhost';
  try {
    return new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean)[3] || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const [section, item] = segmentsFrom(req);

  // Vercel does not populate req.params for catch-all segments, and the
  // handlers expect both ids there, so set them explicitly.
  req.params = { ...(req.params || {}), id: threadIdFrom(req), messageId: item };

  if (section === 'messages') return item ? messageItem(req, res) : messages(req, res);
  if (section === 'images') return item ? imageItem(req, res) : images(req, res);
  if (section === 'typing' && !item) return typing(req, res);

  return sendError(res, 404, 'Unknown chat route');
}
