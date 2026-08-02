import { allowMethods, sendJson } from '../_lib/http.js';

/** POST /api/auth/logout — token is client-held; clearing storage is enough. */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  return sendJson(res, 200, { ok: true });
}
