import { getSupabase } from '../supabase.js';
import {
  allowMethods,
  normalizeUsername,
  sendError,
  sendJson,
  validateUsernameFormat,
} from '../http.js';

function queryUsername(req) {
  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    return url.searchParams.get('u') || '';
  } catch {
    return '';
  }
}

export default async function route(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const username = normalizeUsername(queryUsername(req));
    const formatError = validateUsernameFormat(username);
    if (formatError) return sendJson(res, 200, { ok: false, reason: formatError });

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      console.error('[username-available]', error);
      return sendError(res, 500, 'Could not check username');
    }

    if (data) return sendJson(res, 200, { ok: false, reason: 'That username is already taken' });
    return sendJson(res, 200, { ok: true, reason: 'Available' });
  } catch (err) {
    console.error('[username-available]', err);
    const message = err.message?.includes('Missing ')
      ? 'Server auth is not configured'
      : 'Could not check username';
    return sendError(res, 500, message);
  }
}
