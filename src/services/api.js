/* =====================================================================
 * services/api.js — SINGLE NETWORK BOUNDARY
 * ---------------------------------------------------------------------
 * Listings + E2E chat talk to /api/* (Supabase-backed). Plaintext never
 * leaves the browser — only ciphertext and wrapped conversation keys.
 * ===================================================================== */

import {
  bootstrapIdentity,
  cacheConversationKey,
  clearCryptoSession,
  createConversationKey,
  decryptMessage,
  encryptMessage,
  getCachedConversationKey,
  getCachedPrivateKey,
  getCachedPublicKey,
  isValidPublicKeyB64,
  unwrapConversationKey,
  wrapConversationKey,
} from '../lib/e2eCrypto.js';
import { authHeaders, loadSession } from './authService.js';

export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parseResponse(res, fallback) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(data?.error || fallback, res.status);
  return data;
}

/** GET /api/listings */
export async function getListings() {
  const res = await fetch(`${API_BASE}/listings`);
  return parseResponse(res, 'Failed to load listings');
}

/** GET /api/listings?mine=1 — current user's live tickets */
export async function getMyListings() {
  const res = await fetch(`${API_BASE}/listings?mine=1`, {
    headers: { ...authHeaders() },
  });
  return parseResponse(res, 'Failed to load your listings');
}

/** GET /api/purchases — confirmed deals where I am the buyer */
export async function getPurchases() {
  const res = await fetch(`${API_BASE}/purchases`, {
    headers: { ...authHeaders() },
  });
  return parseResponse(res, 'Failed to load purchases');
}

/** GET /api/theatres — Chennai cinemas + seat types for each. */
export async function getTheatres() {
  const res = await fetch(`${API_BASE}/theatres`);
  const rows = await parseResponse(res, 'Failed to load theatres');
  return (rows || []).map((r) => ({
    name: r.name,
    area: r.area || '',
    seatTypes: Array.isArray(r.seatTypes) && r.seatTypes.length ? r.seatTypes : ['Regular'],
  }));
}

/** GET /api/movies?q= — live / upcoming titles (fuzzy; refreshes from TMDB). */
export async function getMovies(query = '') {
  const q = query.trim();
  const url = q
    ? `${API_BASE}/movies?q=${encodeURIComponent(q)}&limit=12`
    : `${API_BASE}/movies?limit=12`;
  const rows = await parseResponse(await fetch(url), 'Failed to load movies');
  return rows || [];
}

/** POST /api/listings — SELL form */
export async function postTicket(payload) {
  const res = await fetch(`${API_BASE}/listings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(res, 'Failed to post ticket');
}

/* -------- E2E chat keys -------- */

export async function fetchMyKeyBundle() {
  const res = await fetch(`${API_BASE}/chat/keys?me=1`, { headers: { ...authHeaders() } });
  return parseResponse(res, 'Failed to load chat keys');
}

/** Store the public key plus the sealed private key for this account. */
export async function uploadKeyBundle({ publicKey, encPrivateKey, keySalt, keyIv }) {
  const res = await fetch(`${API_BASE}/chat/keys`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ publicKey, encPrivateKey, keySalt, keyIv }),
  });
  return parseResponse(res, 'Failed to save chat keys');
}

export async function fetchPeerPublicKey(username) {
  const res = await fetch(`${API_BASE}/chat/keys?username=${encodeURIComponent(username)}`);
  const data = await parseResponse(res, 'Seller has not enabled encrypted chat yet');
  if (!isValidPublicKeyB64(data.publicKey)) {
    throw new Error('User has not set up encrypted chat yet');
  }
  return data;
}

/**
 * Unlock the account's chat identity in this browser.
 *
 * Pass the password at sign-in so the sealed key can be recovered; later calls
 * reuse the browser cache. Without either, this throws IdentityLockedError and
 * the chat renders in its sealed state.
 */
export async function setupEncryptedChat(password) {
  const session = loadSession();
  if (!session?.userId) throw new Error('Log in required');
  return bootstrapIdentity({
    userId: session.userId,
    password,
    fetchBundle: fetchMyKeyBundle,
    uploadKeys: (keys) => uploadKeyBundle(keys),
  });
}

export function clearChatCrypto() {
  clearCryptoSession();
}

async function ensureConversationKey(thread) {
  const cached = getCachedConversationKey(thread.id);
  if (cached) return cached;

  if (!getCachedPrivateKey()) await setupEncryptedChat();
  const privateKey = getCachedPrivateKey();
  if (!privateKey) throw new Error('Could not set up encrypted chat');
  if (!thread.wrappedKey) throw new Error('Missing conversation key for this chat');

  try {
    const key = await unwrapConversationKey(thread.wrappedKey, privateKey);
    cacheConversationKey(thread.id, key);
    return key;
  } catch (err) {
    throw new Error(err.message?.includes('encoding') ? err.message : 'Could not decrypt this conversation on this device');
  }
}

async function decryptThreadMessages(thread, messages) {
  // Identity keys are per browser, so a thread opened on another browser or
  // origin was sealed to a key this device does not hold. That is not a
  // reason to fail the whole load: timestamps, senders and images still work,
  // so mark the bodies and let the chat render.
  let key = null;
  try {
    key = await ensureConversationKey(thread);
  } catch {
    key = null;
  }

  const out = [];
  for (const m of messages) {
    if (!key) {
      out.push({ ...m, text: '', sealed: true });
      continue;
    }
    let text = m.text;
    if (text == null && m.ciphertext && m.iv) {
      try {
        text = await decryptMessage(key, m.ciphertext, m.iv);
      } catch {
        text = '';
        out.push({ ...m, text, sealed: true });
        continue;
      }
    }
    out.push({ ...m, text: text ?? '' });
  }
  return out;
}

/* -------- chat threads / messages -------- */

/** Open (or reuse) an encrypted negotiation thread for a listing. */
export async function startPurchase({ listing, qty }) {
  await setupEncryptedChat();

  const sellerName = listing.seller;
  if (!sellerName) throw new Error('Listing has no seller');

  // Reuse an open thread if one already exists (same wrapped keys).
  const existingList = await fetch(`${API_BASE}/chat/threads`, { headers: { ...authHeaders() } });
  const existing = (await parseResponse(existingList, 'Failed to load conversations')).find(
    (t) => t.listingId === listing.id,
  );
  if (existing) {
    try {
      const messages = await getMessages(existing.id, { ...existing, qty });
      return { ...existing, qty, messages };
    } catch {
      // Old / corrupt wraps — still open the chat UI
      return { ...existing, qty, messages: [] };
    }
  }

  let peer;
  try {
    peer = await fetchPeerPublicKey(sellerName);
  } catch (err) {
    const pending = {
      id: `pending_${listing.id}`,
      listingId: listing.id,
      listing,
      qty,
      status: 'open',
      with: sellerName,
      role: 'buyer',
      wrappedKey: null,
      pendingSellerKeys: true,
      messages: [
        {
          id: 'sys_pending',
          from: 'them',
          text: `Chat is open. Ask ${sellerName} to open Tickets reZale once so message encryption can finish — only you two will be able to read this chat.`,
          at: Date.now(),
          read: true,
        },
      ],
    };
    const msg = err.message || '';
    if (/not set up encrypted chat|invalid chat public key|409/i.test(msg) || msg.includes('encrypted chat')) {
      return pending;
    }
    throw err;
  }

  const myPublic = getCachedPublicKey();
  if (!isValidPublicKeyB64(myPublic)) throw new Error('Could not register chat keys');

  const convKey = await createConversationKey();
  const buyerWrappedKey = await wrapConversationKey(convKey, myPublic);
  const sellerWrappedKey = await wrapConversationKey(convKey, peer.publicKey);

  const res = await fetch(`${API_BASE}/chat/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      listingId: listing.id,
      qty,
      buyerWrappedKey: JSON.stringify(buyerWrappedKey),
      sellerWrappedKey: JSON.stringify(sellerWrappedKey),
    }),
  });
  const thread = await parseResponse(res, 'Failed to start encrypted chat');
  cacheConversationKey(thread.id, convKey);

  const messages = await getMessages(thread.id, thread);
  return { ...thread, messages };
}

export async function getThreads() {
  await setupEncryptedChat().catch(() => {});
  const res = await fetch(`${API_BASE}/chat/threads`, { headers: { ...authHeaders() } });
  const threads = await parseResponse(res, 'Failed to load conversations');
  // List only — messages load on open / live poll (instant IM)
  return (threads || []).map((t) => ({ ...t, messages: t.messages || [] }));
}

/** Load one thread; 403 if caller is not a participant. */
export async function getThread(threadId) {
  const res = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}`, {
    headers: { ...authHeaders() },
  });
  return parseResponse(res, 'Access denied');
}

export async function getMessages(threadId, threadHint, { after = 0 } = {}) {
  const qs = after > 0 ? `&after=${encodeURIComponent(after)}` : '';
  const res = await fetch(
    `${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=messages${qs}`,
    { headers: { ...authHeaders() } },
  );
  const rows = await parseResponse(res, 'Failed to load messages');
  const thread = threadHint || { id: threadId, wrappedKey: null };
  if (!thread.wrappedKey && !getCachedConversationKey(threadId)) {
    const detail = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}`, {
      headers: { ...authHeaders() },
    });
    const full = await parseResponse(detail, 'Failed to load conversation');
    return decryptThreadMessages(full, rows || []);
  }
  return decryptThreadMessages(thread, rows || []);
}

/** Fetch only messages newer than `after` (ms). */
export async function pollMessages(threadId, after, threadHint) {
  return getMessages(threadId, threadHint, { after });
}

export async function sendMessage(threadId, text, threadHint) {
  const thread = threadHint || { id: threadId };
  const key = await ensureConversationKey(thread);
  const { ciphertext, iv } = await encryptMessage(key, text);

  const res = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ciphertext, iv }),
  });
  const saved = await parseResponse(res, 'Failed to send message');
  return { ...saved, text, pending: false, kind: 'text' };
}

/** Edit one of the current user's text messages. Window enforced server-side. */
export async function editMessage(threadId, messageId, text, threadHint) {
  const thread = threadHint || { id: threadId };
  const key = await ensureConversationKey(thread);
  const { ciphertext, iv } = await encryptMessage(key, text);

  const res = await fetch(
    `${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=messages&messageId=${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ciphertext, iv }),
    },
  );
  const saved = await parseResponse(res, 'Failed to edit message');
  return { ...saved, text, pending: false };
}

/** scope 'me' hides it for you; scope 'all' tombstones it for both parties. */
export async function deleteMessage(threadId, messageId, scope = 'me') {
  const res = await fetch(
    `${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=messages&messageId=${encodeURIComponent(messageId)}&scope=${scope === 'all' ? 'all' : 'me'}`,
    { method: 'DELETE', headers: { ...authHeaders() } },
  );
  return parseResponse(res, 'Failed to delete message');
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Upload a chat image (max 5 MB). Caption is E2E-encrypted; file goes to Storage. */
export async function sendImage(threadId, file, threadHint) {
  if (!file) throw new Error('No image selected');
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Only image files are allowed');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image must be under 5 MB');
  }

  const thread = threadHint || { id: threadId };
  const key = await ensureConversationKey(thread);
  const caption = `[Image] ${file.name || 'photo'}`;
  const { ciphertext, iv } = await encryptMessage(key, caption);

  const signRes = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      intent: 'sign',
      mime: file.type,
      name: file.name || 'image',
      bytes: file.size,
    }),
  });
  const signed = await parseResponse(signRes, 'Failed to prepare image upload');

  const put = await fetch(signed.signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': signed.mime || file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!put.ok) {
    throw new ApiError('Could not upload image to storage', put.status);
  }

  const commitRes = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      intent: 'commit',
      messageId: signed.messageId,
      path: signed.path,
      mime: signed.mime || file.type,
      name: signed.name || file.name || 'image',
      bytes: file.size,
      ciphertext,
      iv,
    }),
  });
  const saved = await parseResponse(commitRes, 'Failed to send image');
  return {
    ...saved,
    text: caption,
    pending: false,
    kind: 'image',
    hasImage: true,
    localPreview: URL.createObjectURL(file),
  };
}

/** Authenticated image URL for display/download. */
export function imageUrl(threadId, messageId, { download = false } = {}) {
  const q = download ? '&download=1' : '';
  return `${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=images&messageId=${encodeURIComponent(messageId)}${q}`;
}

/** Fetch image blob with auth (for <img> via object URL or file download). */
export async function fetchImageBlob(threadId, messageId, { download = false } = {}) {
  const res = await fetch(imageUrl(threadId, messageId, { download }), {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    let msg = 'Failed to load image';
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  return res.blob();
}

export async function downloadImage(threadId, messageId, filename = 'ticket-image') {
  const blob = await fetchImageBlob(threadId, messageId, { download: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function markThreadRead(threadId) {
  const res = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=messages`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ read: true }),
  });
  return parseResponse(res, 'Failed to update read state');
}

/** Heartbeat while composing — peer sees typing dots for a few seconds. */
export async function setTyping(threadId, typing) {
  const res = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=typing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ typing: !!typing }),
  });
  return parseResponse(res, 'Failed to update typing');
}

export async function getPeerTyping(threadId) {
  const res = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}?section=typing`, {
    headers: { ...authHeaders() },
  });
  const data = await parseResponse(res, 'Failed to load typing');
  return !!data.peerTyping;
}

export async function confirmDeal(threadId) {
  const res = await fetch(`${API_BASE}/chat/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ confirm: true }),
  });
  return parseResponse(res, 'Failed to confirm deal');
}

export async function deleteListing(id) {
  const res = await fetch(`${API_BASE}/listings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  return parseResponse(res, 'Failed to delete listing');
}
