# Tickets reZale

A peer-to-peer marketplace for movie tickets. List a seat you can't use, chat with the buyer,
hand it over at face value.

Implemented from the Claude Design project
[Tickets reZale marketplace app](https://claude.ai/design/p/ed8bb1e8-3892-4b9c-8d2d-1eb4940819d0).
The exported design file is not tracked in this repo — pull it from the project link above
if you need to check a value against the original.

## Running it

```bash
cp .env.example .env   # fill in Supabase + JWT_SECRET
npm install
npm run dev            # http://localhost:5173 (UI + /api auth)
npm run build          # production bundle in dist/
npm run preview        # serve the build (API needs Vercel / vercel dev)
```

## Auth + Supabase setup

1. Create a [Supabase](https://supabase.com) project.
2. In **SQL Editor**, run `supabase/schema.sql`, then `supabase/theatres.sql`, `supabase/movies.sql`, and `supabase/chat.sql`.
3. Copy **Project URL** and **service_role** key from **Settings → API** into `.env`.
4. Get a free [TMDB API key](https://www.themoviedb.org/settings/api) and set `TMDB_API_KEY` (movie dropdown).

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=a-long-random-secret
TMDB_API_KEY=your-tmdb-api-key
```

Passwords are stored as **bcrypt hashes** (not plaintext). The service role key stays on the server only.

Movie suggestions refresh from TMDB about every 12 hours into the `movies` table. Typing uses fuzzy match (case/punctuation/typos) and falls back to live TMDB search so new releases show up without a redeploy.

### API routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create account |
| `POST` | `/api/auth/login` | Log in |
| `GET` | `/api/auth/username-available?u=` | Username check |
| `POST` | `/api/auth/logout` | Client logout ack |
| `GET` | `/api/listings` | All live tickets (Buy tab) |
| `GET` | `/api/listings?mine=1` | Current user’s tickets (auth) |
| `POST` | `/api/listings` | Post a ticket (auth) |
| `GET` | `/api/theatres` | Theatres within 50 km of Chennai Central |
| `GET` | `/api/movies?q=` | Live/upcoming movie suggestions (TMDB + fuzzy) |
| `GET`/`PUT` | `/api/chat/keys` | Public key lookup / upload sealed identity keys |
| `GET`/`POST` | `/api/chat/threads` | List / open buyer↔seller threads |
| `GET`/`PATCH` | `/api/chat/threads/:id` | Thread detail / confirm deal |
| `GET`/`POST`/`PATCH` | `/api/chat/threads/:id/messages` | Ciphertext messages (E2E) |

## Routes (no personal data in URLs)

| Path | Access |
| --- | --- |
| `/login` | Public |
| `/buy` | Auth required |
| `/sell` | Auth required |
| `/chats` | Auth required |
| `/chats/:threadId` | Auth + **buyer or seller only** (opaque UUID) |

Changing `/chats/:threadId` to another conversation you are not in returns **403 Access denied**.

## Deploy on Vercel

1. Push the repo and import it in Vercel (framework: Vite is auto-detected).
2. Add the same three env vars under **Project → Settings → Environment Variables**.
3. Deploy. `vercel.json` keeps SPA routing working while leaving `/api/*` to serverless functions.

```bash
npx vercel          # preview
npx vercel --prod   # production
```

## What's here

| Path | |
| --- | --- |
| `src/App.jsx` | Session, screen routing (auth → app → chat), listings, toasts |
| `src/screens/AuthScreen.jsx` | Sign up / log in, username availability, password strength |
| `src/screens/BuyPanel.jsx` | Search, filter chips, sortable table (cards under 900px) |
| `src/screens/SellPanel.jsx` | Post a ticket, optimistic "My listings" |
| `src/screens/ChatScreen.jsx` | Thread list, deal stub, messages, composer |
| `src/hooks/useChat.js` | Encrypted negotiation threads |
| `src/lib/e2eCrypto.js` | ECDH + AES-GCM client crypto (Web Crypto) |
| `src/services/api.js` | **Single network boundary** — listings, chat, keys |
| `src/services/authService.js` | Signup, login, username check → `/api/auth/*` |
| `api/auth/` | Vercel serverless auth handlers (Supabase + JWT) |
| `api/chat/` | E2E chat keys, threads, ciphertext messages |
| `api/listings.js` | GET/POST ticket listings |
| `supabase/schema.sql` | `users` + `tickets` DDL |
| `supabase/chat.sql` | Chat columns + `chat_threads` / `chat_messages` |
| `src/styles/` | Design tokens (`tokens.css`) and component styles (`app.css`) |

## Backend

- Listings are live against Supabase via `/api/listings`.
- Auth is live via `/api/auth/*`. Sessions use `localStorage` when "Remember me" is checked,
  otherwise `sessionStorage`.
- Buyer↔seller chat is **end-to-end encrypted** for message bodies: the server stores only
  ciphertext and per-thread keys wrapped to each party’s public key. Identity keys live on
  the device (no password unlock). Only the buyer and seller can decrypt messages.
- Chat is live: messages send optimistically and the open thread polls about every second
  so both sides see new messages like a normal messenger.

## Preview knobs

| Query | Effect |
| --- | --- |
| `?theme=light` | Start in the light palette |

## Notes on the port

- The design's inline styles and its `style-hover` / `style-focus` / `style-active` attributes
  are real CSS in `src/styles/app.css`; values are unchanged. Disabled/active button variants
  come from `:disabled` and `[aria-pressed]` / `[aria-selected]` rather than computed props.
- The 900px breakpoint drives both a media query (grid columns) and `useIsWide()` for the
  switches that need different markup — the sign-in pitch pane, table vs. cards, chat sidebar.
- Behaviour kept as designed even though it reads oddly: the listings count line says
  "Fetching the marketplace…" whenever the load isn't `done`, including the error state.
