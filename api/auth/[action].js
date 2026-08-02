import { sendError } from '../_lib/http.js';
import login from '../_lib/routes/auth-login.js';
import logout from '../_lib/routes/auth-logout.js';
import signup from '../_lib/routes/auth-signup.js';
import usernameAvailable from '../_lib/routes/auth-username-available.js';

/**
 * Single entry point for /api/auth/*.
 *
 * The four auth endpoints share one serverless function because Vercel's
 * Hobby plan caps a deployment at 12 of them. Each handler still lives in its
 * own module under _lib/routes (underscore paths are not routed), so this
 * file only dispatches.
 */
const ROUTES = {
  signup,
  login,
  logout,
  'username-available': usernameAvailable,
};

function actionFrom(req) {
  if (req.query?.action) {
    return Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  }
  if (req.params?.action) return req.params.action;
  const host = req.headers?.host || 'localhost';
  try {
    const parts = new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean);
    return parts[2] || null; // /api/auth/:action
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const action = actionFrom(req);
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
  if (!route) return sendError(res, 404, 'Unknown auth action');
  return route(req, res);
}
