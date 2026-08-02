import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const ROUTES = {
  '/api/listings': () => import('./api/listings.js'),
  '/api/theatres': () => import('./api/theatres.js'),
  '/api/movies': () => import('./api/movies.js'),
  '/api/chat/keys': () => import('./api/chat/keys.js'),
  '/api/chat/threads': () => import('./api/chat/threads.js'),
  '/api/chat/cleanup': () => import('./api/chat/cleanup.js'),
  '/api/purchases': () => import('./api/purchases.js'),
};

/** Mirrors Vercel's file routing for the dev server. */
function matchDynamic(path) {
  const auth = path.match(/^\/api\/auth\/([^/]+)\/?$/);
  if (auth) {
    return {
      load: () => import('./api/auth/[action].js'),
      params: { action: auth[1] },
      query: { action: auth[1] },
    };
  }

  const listing = path.match(/^\/api\/listings\/([^/]+)\/?$/);
  if (listing) {
    return {
      load: () => import('./api/listings/[id].js'),
      params: { id: listing[1] },
    };
  }
  const threadSub = path.match(/^\/api\/chat\/threads\/([^/]+)\/(.+?)\/?$/);
  if (threadSub) {
    const rest = threadSub[2].split('/');
    return {
      load: () => import('./api/chat/threads/[id]/[...rest].js'),
      params: { id: threadSub[1] },
      query: { id: threadSub[1], rest },
    };
  }

  const thread = path.match(/^\/api\/chat\/threads\/([^/]+)\/?$/);
  if (thread) {
    return {
      load: () => import('./api/chat/threads/[id].js'),
      params: { id: thread[1] },
    };
  }
  return null;
}

/** Mount Vercel-style /api handlers inside Vite so `npm run dev` works locally. */
function localApiPlugin() {
  return {
    name: 'local-api',
    configureServer(server) {
      const handle = async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        const staticLoad = ROUTES[path];
        const dynamic = staticLoad ? null : matchDynamic(path);
        const load = staticLoad || dynamic?.load;
        if (!load) return next();

        try {
          if (dynamic?.params) req.params = { ...(req.params || {}), ...dynamic.params };
          if (dynamic?.query) req.query = { ...(req.query || {}), ...dynamic.query };
          const { default: handler } = await load();
          await handler(req, res);
        } catch (err) {
          console.error('[local-api]', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
      };

      // Run after Vite installs its middleware, then jump to the front of the
      // stack so /api/* is not treated as a source module (api/*.js on disk).
      return () => {
        server.middlewares.stack.unshift({ route: '', handle });
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET', 'TMDB_API_KEY']) {
    if (env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), localApiPlugin()],
    server: { port: 5173 },
  };
});
