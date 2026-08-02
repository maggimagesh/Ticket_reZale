import { getAuthUser } from '../_lib/auth-request.js';
import { allowMethods, readJson, sendError, sendJson } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

/**
 * GET  /api/chat/keys?username= — public key for a peer
 * GET  /api/chat/keys?me=1 — own public + encrypted private bundle (auth)
 * PUT  /api/chat/keys — upload/replace public + sealed private key (auth)
 */
export default async function handler(req, res) {
  const method = (req.method || '').toUpperCase();
  if (!allowMethods(req, res, ['GET', 'PUT'])) return;

  try {
    if (method === 'GET') return await getKeys(req, res);
    return await putKeys(req, res);
  } catch (err) {
    console.error('[chat/keys]', err);
    return sendError(res, 500, err.message?.includes('Missing ') ? 'Server is not configured' : 'Key request failed');
  }
}

async function getKeys(req, res) {
  const host = req.headers?.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const me = url.searchParams.get('me') === '1';
  const username = (url.searchParams.get('username') || '').trim().toLowerCase();
  const supabase = getSupabase();

  if (me) {
    const user = getAuthUser(req);
    if (!user) return sendError(res, 401, 'Log in required');
    const { data, error } = await supabase
      .from('users')
      .select('id, username, public_key, enc_private_key, key_salt, key_iv')
      .eq('id', user.id)
      .single();
    if (error) {
      console.error('[chat/keys me]', error);
      return sendError(res, 500, 'Could not load keys');
    }
    return sendJson(res, 200, {
      userId: data.id,
      username: data.username,
      publicKey: data.public_key || null,
      encPrivateKey: data.enc_private_key || null,
      keySalt: data.key_salt || null,
      keyIv: data.key_iv || null,
    });
  }

  if (!username) return sendError(res, 400, 'username or me=1 required');

  const { data, error } = await supabase
    .from('users')
    .select('id, username, public_key')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    console.error('[chat/keys peer]', error);
    return sendError(res, 500, 'Could not load public key');
  }
  if (!data) return sendError(res, 404, 'User not found');
  if (!data.public_key || data.public_key.length < 80) {
    return sendError(res, 409, 'User has not set up encrypted chat yet');
  }

  return sendJson(res, 200, {
    userId: data.id,
    username: data.username,
    publicKey: data.public_key,
  });
}

async function putKeys(req, res) {
  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendError(res, 400, 'Invalid JSON body');
  }

  const publicKey = String(body.publicKey || '').trim();
  if (!publicKey) return sendError(res, 400, 'publicKey is required');

  const supabase = getSupabase();
  const patch = { public_key: publicKey };
  // Optional legacy sealed-private fields (ignored by new clients)
  if (body.encPrivateKey) patch.enc_private_key = String(body.encPrivateKey);
  if (body.keySalt) patch.key_salt = String(body.keySalt);
  if (body.keyIv) patch.key_iv = String(body.keyIv);

  const { error } = await supabase.from('users').update(patch).eq('id', user.id);

  if (error) {
    console.error('[chat/keys put]', error);
    return sendError(res, 500, 'Could not save keys');
  }

  return sendJson(res, 200, { ok: true, publicKey });
}
