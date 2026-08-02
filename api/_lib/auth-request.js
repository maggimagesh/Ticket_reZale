import { verifyToken } from './token.js';

/** Read Bearer JWT and return { id, username } or null. */
export function getAuthUser(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const payload = verifyToken(match[1]);
    if (!payload?.sub || !payload?.username) return null;
    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}
