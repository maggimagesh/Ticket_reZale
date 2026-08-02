'use strict';

/*
 * Zoho Catalyst Advanced I/O adapter.
 *
 * The application handlers remain in the root `api/` directory for Vercel.
 * `npm run catalyst:prepare-api` copies that directory beside this adapter
 * immediately before Catalyst serves or deploys it. This native HTTP app is
 * intentionally dependency-free: Catalyst passes the standard Node req/res
 * objects used by the existing Vercel handlers.
 */
const handlerModules = {
  listings: './api/listings.js',
  listingDetail: './api/listings/[id].js',
  purchases: './api/purchases.js',
  theatres: './api/theatres.js',
  movies: './api/movies.js',
  auth: './api/auth/[action].js',
  chatKeys: './api/chat/keys.js',
  chatThreads: './api/chat/threads.js',
  chatThreadDetail: './api/chat/threads/[id].js',
  chatCleanup: './api/chat/cleanup.js',
};

const loadedHandlers = new Map();

async function loadHandler(name) {
  if (!loadedHandlers.has(name)) {
    loadedHandlers.set(name, import(handlerModules[name]).then((mod) => mod.default));
  }
  return loadedHandlers.get(name);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function applyCors(req, res) {
  const origin = String(req.headers?.origin || '');
  if (!origin) return;

  const configured = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  let allowed = configured.includes('*') || configured.includes(origin);

  // Slate deployments receive a unique *.onslate.<tld> origin. Accepting
  // Catalyst Slate and local development origins keeps preview deployments
  // working without exposing credentials (this API uses bearer tokens, not
  // cookies).
  try {
    const hostname = new URL(origin).hostname;
    allowed ||= /\.onslate\.(com|eu|in|au|ca)$/i.test(hostname);
    allowed ||= hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return;
  }

  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
}

function routeFor(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const staticRoute = {
    '/api/listings': 'listings',
    '/api/purchases': 'purchases',
    '/api/theatres': 'theatres',
    '/api/movies': 'movies',
    '/api/chat/keys': 'chatKeys',
    '/api/chat/threads': 'chatThreads',
    '/api/chat/cleanup': 'chatCleanup',
  }[path];
  if (staticRoute) return { name: staticRoute };

  let match = path.match(/^\/api\/auth\/([^/]+)$/);
  if (match) return { name: 'auth', params: { action: decodeURIComponent(match[1]) } };

  match = path.match(/^\/api\/listings\/([^/]+)$/);
  if (match) return { name: 'listingDetail', params: { id: decodeURIComponent(match[1]) } };

  match = path.match(/^\/api\/chat\/threads\/([^/]+)$/);
  if (match) return { name: 'chatThreadDetail', params: { id: decodeURIComponent(match[1]) } };

  return null;
}

async function app(req, res) {
  try {
    applyCors(req, res);
    if ((req.method || '').toUpperCase() === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return undefined;
    }

    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const route = routeFor(url.pathname);
    if (!route) return sendJson(res, 404, { error: 'API route not found' });

    // Match Vercel's dynamic route fields. Existing handlers also retain their
    // URL parsing fallback, so this is additive rather than platform-specific.
    if (route.params) {
      req.params = { ...(req.params || {}), ...route.params };
      req.query = { ...(req.query || {}), ...route.params };
    }

    const handler = await loadHandler(route.name);
    return handler(req, res);
  } catch (error) {
    console.error('[catalyst api]', error);
    if (!res.headersSent) return sendJson(res, 500, { error: 'Internal server error' });
    return undefined;
  }
}

module.exports = app;
