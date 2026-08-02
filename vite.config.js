import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const ROUTES = {
  '/api/auth/signup': () => import('./api/auth/signup.js'),
  '/api/auth/login': () => import('./api/auth/login.js'),
  '/api/auth/username-available': () => import('./api/auth/username-available.js'),
  '/api/auth/logout': () => import('./api/auth/logout.js'),
  '/api/listings': () => import('./api/listings.js'),
  '/api/theatres': () => import('./api/theatres.js'),
  '/api/movies': () => import('./api/movies.js'),
  '/api/chat/keys': () => import('./api/chat/keys.js'),
  '/api/chat/threads': () => import('./api/chat/threads.js'),
  '/api/chat/cleanup': () => import('./api/chat/cleanup.js'),
  '/api/purchases': () => import('./api/purchases.js'),
};

/** Match /api/listings/:id and /api/chat/threads/:id(/messages|/typing) */
function matchDynamic(path) {
  const listing = path.match(/^\/api\/listings\/([^/]+)\/?$/);
  if (listing) {
    return {
      load: () => import('./api/listings/[id].js'),
      params: { id: listing[1] },
    };
  }
  const typing = path.match(/^\/api\/chat\/threads\/([^/]+)\/typing\/?$/);
  if (typing) {
    return {
      load: () => import('./api/chat/threads/[id]/typing.js'),
      params: { id: typing[1] },
    };
  }
  const imageFile = path.match(/^\/api\/chat\/threads\/([^/]+)\/images\/([^/]+)\/?$/);
  if (imageFile) {
    return {
      load: () => import('./api/chat/threads/[id]/images/[messageId].js'),
      params: { id: imageFile[1], messageId: imageFile[2] },
    };
  }
  const images = path.match(/^\/api\/chat\/threads\/([^/]+)\/images\/?$/);
  if (images) {
    return {
      load: () => import('./api/chat/threads/[id]/images.js'),
      params: { id: images[1] },
    };
  }
  // Must be tested before the plain /messages route below
  const messageItem = path.match(/^\/api\/chat\/threads\/([^/]+)\/messages\/([^/]+)\/?$/);
  if (messageItem) {
    return {
      load: () => import('./api/chat/threads/[id]/messages/[messageId].js'),
      params: { id: messageItem[1], messageId: messageItem[2] },
    };
  }
  const messages = path.match(/^\/api\/chat\/threads\/([^/]+)\/messages\/?$/);
  if (messages) {
    return {
      load: () => import('./api/chat/threads/[id]/messages.js'),
      params: { id: messages[1] },
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
