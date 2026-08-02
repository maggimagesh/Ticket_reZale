import { getSupabase } from '../supabase.js';
import { verifyPassword } from '../password.js';
import { signToken } from '../token.js';
import {
  allowMethods,
  normalizeUsername,
  readJson,
  sendError,
  sendJson,
} from '../http.js';

export default async function route(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    const remember = body.remember !== false;

    if (!username || !password) {
      return sendError(res, 400, 'Enter your username and password');
    }

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, password_hash')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      console.error('[login] lookup', error);
      return sendError(res, 500, 'Could not log in');
    }

    const ok = user && (await verifyPassword(password, user.password_hash));
    if (!ok) return sendError(res, 401, 'Incorrect username or password');

    const token = signToken({ id: user.id, username: user.username }, { remember });
    return sendJson(res, 200, { username: user.username, userId: user.id, token });
  } catch (err) {
    console.error('[login]', err);
    const message = err.message?.includes('Missing ')
      ? 'Server auth is not configured'
      : err.message === 'Invalid JSON body'
        ? err.message
        : 'Could not log in';
    return sendError(res, err.message === 'Invalid JSON body' ? 400 : 500, message);
  }
}
