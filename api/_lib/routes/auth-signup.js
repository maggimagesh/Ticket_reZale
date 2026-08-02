import { getSupabase } from '../supabase.js';
import { hashPassword, passwordMeetsRules } from '../password.js';
import { signToken } from '../token.js';
import {
  allowMethods,
  normalizeUsername,
  readJson,
  sendError,
  sendJson,
  validateUsernameFormat,
} from '../http.js';

export default async function route(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    const remember = body.remember !== false;

    const formatError = validateUsernameFormat(username);
    if (formatError) return sendError(res, 400, formatError);
    if (!passwordMeetsRules(password)) {
      return sendError(res, 400, 'Password does not meet the required rules');
    }

    const supabase = getSupabase();
    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (lookupError) {
      console.error('[signup] lookup', lookupError);
      return sendError(res, 500, 'Could not create account');
    }
    if (existing) return sendError(res, 409, 'That username is already taken');

    const password_hash = await hashPassword(password);
    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert({ username, password_hash })
      .select('id, username')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return sendError(res, 409, 'That username is already taken');
      }
      console.error('[signup] insert', insertError);
      return sendError(res, 500, 'Could not create account');
    }

    const token = signToken({ id: user.id, username: user.username }, { remember });
    return sendJson(res, 201, { username: user.username, userId: user.id, token });
  } catch (err) {
    console.error('[signup]', err);
    const message = err.message?.includes('Missing ')
      ? 'Server auth is not configured'
      : err.message === 'Invalid JSON body'
        ? err.message
        : 'Could not create account';
    return sendError(res, err.message === 'Invalid JSON body' ? 400 : 500, message);
  }
}
