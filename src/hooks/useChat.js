import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../services/api.js';
import { getCachedPrivateKey } from '../lib/e2eCrypto.js';

const POLL_MS = 1200;
const LIST_POLL_MS = 4000;
const TYPING_PING_MS = 1600;

function mergeMessages(prev = [], incoming = []) {
  if (!incoming.length) return prev;
  const map = new Map();
  for (const m of prev) map.set(m.id, m);
  for (const m of incoming) {
    const existing = map.get(m.id);
    map.set(m.id, existing ? { ...existing, ...m } : m);
  }
  return [...map.values()]
    // "Delete for me" — drop it from this device entirely
    .filter((m) => m.deleted !== 'me')
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

/**
 * Poll cursor. Tracks syncAt (server updated_at), not the created-at
 * timestamp, so edits and deletes to older messages are picked up too.
 */
function lastMessageAt(messages = []) {
  let max = 0;
  for (const m of messages) {
    if (m.pending) continue;
    const stamp = m.syncAt || m.at || 0;
    if (stamp > max) max = stamp;
  }
  return max;
}

function isLiveThread(id, thread) {
  return id && !String(id).startsWith('pending_') && thread && !thread.pendingSellerKeys;
}

/** Instant messaging for buyer↔seller E2E threads. */
export function useChat() {
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dealDone, setDealDone] = useState(false);
  const [cryptoReady, setCryptoReady] = useState(() => !!getCachedPrivateKey());
  const [error, setError] = useState(null);
  const [peerOnline, setPeerOnline] = useState(false);
  const [typing, setTyping] = useState(false);

  const threadsRef = useRef(threads);
  const activeIdRef = useRef(activeId);
  const pollBusy = useRef(false);
  const lastTypingPing = useRef(0);
  const typingActive = useRef(false);
  const typingStopTimer = useRef(null);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const active = threads.find((t) => t.id === activeId) ?? threads[0] ?? null;

  const patchThread = useCallback((id, fn) => {
    setThreads((list) => list.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.getThreads();
      setThreads((prev) => {
        const prevMap = new Map(prev.map((t) => [t.id, t]));
        const active = activeIdRef.current;
        return list.map((t) => {
          const old = prevMap.get(t.id);
          const viewing = t.id === active;
          return {
            ...t,
            messages: old?.messages || [],
            // Active chat is treated as read while open
            unreadCount: viewing ? 0 : Number(t.unreadCount) || 0,
          };
        });
      });
      setError(null);
      return list;
    } catch (err) {
      setError(err.message || 'Could not load chats');
      return [];
    }
  }, []);

  const markThreadSeen = useCallback(
    async (id) => {
      await api.markThreadRead(id).catch(() => {});
      patchThread(id, (t) => ({
        ...t,
        unreadCount: 0,
        messages: (t.messages || []).map((m) =>
          m.from === 'them' ? { ...m, read: true } : m,
        ),
      }));
    },
    [patchThread],
  );

  const seed = useCallback(async () => {
    try {
      await api.setupEncryptedChat();
      setCryptoReady(true);
      await refresh();
      return true;
    } catch {
      setCryptoReady(false);
      setThreads([]);
      return false;
    }
  }, [refresh]);

  const clearMyTyping = useCallback(async () => {
    clearTimeout(typingStopTimer.current);
    const id = activeIdRef.current;
    const thread = threadsRef.current.find((t) => t.id === id);
    if (!typingActive.current || !isLiveThread(id, thread)) {
      typingActive.current = false;
      return;
    }
    typingActive.current = false;
    await api.setTyping(id, false).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    clearMyTyping();
    api.clearChatCrypto();
    setThreads([]);
    setActiveId(null);
    setDealDone(false);
    setLoading(false);
    setCryptoReady(false);
    setError(null);
    setPeerOnline(false);
    setTyping(false);
  }, [clearMyTyping]);

  const loadMessages = useCallback(
    async (id, threadHint) => {
      if (!id || String(id).startsWith('pending_')) return [];
      const thread = threadHint || threadsRef.current.find((t) => t.id === id);
      if (!thread || thread.pendingSellerKeys) return [];
      const messages = await api.getMessages(id, thread);
      patchThread(id, (t) => ({
        ...t,
        unreadCount: 0,
        messages: mergeMessages(t.messages, messages).map((m) =>
          m.from === 'them' ? { ...m, read: true } : m,
        ),
      }));
      await markThreadSeen(id);
      return messages;
    },
    [markThreadSeen, patchThread],
  );

  const openThread = useCallback(
    async (id) => {
      await clearMyTyping();
      setTyping(false);
      setActiveId(id);
      const existing = threadsRef.current.find((t) => t.id === id);
      setDealDone(!!(existing?.iConfirmed || existing?.sold));
      // Clear pane content so switch shows loader, not the previous chat’s bubbles
      patchThread(id, (t) => ({ ...t, unreadCount: 0, messages: [] }));
      setLoading(true);
      try {
        await loadMessages(id);
      } finally {
        // Only clear loader if we’re still on this thread
        if (activeIdRef.current === id) setLoading(false);
      }
    },
    [clearMyTyping, loadMessages, patchThread],
  );

  /** Buy Now: open chat immediately, then attach the real thread. */
  const startPurchase = useCallback(async (listing, qty) => {
    setDealDone(false);
    setError(null);
    setTyping(false);

    const optimisticId = `pending_${listing.id}`;
    const optimistic = {
      id: optimisticId,
      listingId: listing.id,
      listing,
      qty,
      status: 'open',
      with: listing.seller || 'seller',
      role: 'buyer',
      wrappedKey: null,
      unreadCount: 0,
      messages: [],
    };

    setThreads((list) => {
      const withoutDup = list.filter((t) => t.listingId !== listing.id && t.id !== optimisticId);
      return [optimistic, ...withoutDup];
    });
    setActiveId(optimisticId);
    setLoading(true);

    try {
      await api.setupEncryptedChat();
      setCryptoReady(true);
      const thread = await api.startPurchase({ listing, qty });
      setThreads((list) => {
        const rest = list.filter((t) => t.id !== optimisticId && t.id !== thread.id);
        return [{ ...thread, messages: thread.messages || [], unreadCount: 0 }, ...rest];
      });
      setActiveId(thread.id);
      setLoading(false);
      return thread;
    } catch (err) {
      setLoading(false);
      setError(err.message || 'Could not start chat');
      throw err;
    }
  }, []);

  /**
   * Call while the composer changes. Pings the server so the peer sees
   * the typing animation; clears a few seconds after the last keystroke.
   */
  const notifyTyping = useCallback(
    (draftText) => {
      const id = activeIdRef.current;
      const thread = threadsRef.current.find((t) => t.id === id);
      if (!isLiveThread(id, thread)) return;

      clearTimeout(typingStopTimer.current);

      if (!String(draftText || '').trim()) {
        if (typingActive.current) clearMyTyping();
        return;
      }

      const now = Date.now();
      if (!typingActive.current || now - lastTypingPing.current > TYPING_PING_MS) {
        typingActive.current = true;
        lastTypingPing.current = now;
        api.setTyping(id, true).catch(() => {});
      }

      typingStopTimer.current = setTimeout(() => {
        clearMyTyping();
      }, 2800);
    },
    [clearMyTyping],
  );

  /** Optimistic send — message appears instantly, then syncs to server. */
  const send = useCallback(
    async (text) => {
      const thread = threadsRef.current.find((t) => t.id === activeIdRef.current) || null;
      const trimmed = text.trim();
      if (!trimmed || !thread) return;
      if (thread.pendingSellerKeys || String(thread.id).startsWith('pending_')) {
        throw new Error('Waiting for the seller to enable secure chat');
      }

      await clearMyTyping();

      const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const optimistic = {
        id: tempId,
        from: 'me',
        text: trimmed,
        at: Date.now(),
        read: false,
        pending: true,
      };
      patchThread(thread.id, (t) => ({
        ...t,
        messages: [...(t.messages || []), optimistic],
      }));

      try {
        const saved = await api.sendMessage(thread.id, trimmed, thread);
        patchThread(thread.id, (t) => ({
          ...t,
          messages: mergeMessages(
            (t.messages || []).filter((m) => m.id !== tempId),
            [saved],
          ),
        }));
        return saved;
      } catch (err) {
        patchThread(thread.id, (t) => ({
          ...t,
          messages: (t.messages || []).filter((m) => m.id !== tempId),
        }));
        throw err;
      }
    },
    [clearMyTyping, patchThread],
  );

  const sendImage = useCallback(
    async (file) => {
      const thread = threadsRef.current.find((t) => t.id === activeIdRef.current) || null;
      if (!file || !thread) return;
      if (thread.pendingSellerKeys || String(thread.id).startsWith('pending_')) {
        throw new Error('Waiting for the seller to enable secure chat');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image must be under 5 MB');
      }
      if (!String(file.type || '').startsWith('image/')) {
        throw new Error('Only image files are allowed');
      }

      await clearMyTyping();

      const tempId = `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const preview = URL.createObjectURL(file);
      const optimistic = {
        id: tempId,
        from: 'me',
        text: `[Image] ${file.name || 'photo'}`,
        at: Date.now(),
        read: false,
        pending: true,
        kind: 'image',
        hasImage: true,
        localPreview: preview,
        imageName: file.name,
      };
      patchThread(thread.id, (t) => ({
        ...t,
        messages: [...(t.messages || []), optimistic],
      }));

      try {
        const saved = await api.sendImage(thread.id, file, thread);
        patchThread(thread.id, (t) => ({
          ...t,
          messages: mergeMessages(
            (t.messages || []).filter((m) => m.id !== tempId),
            [{ ...saved, localPreview: preview }],
          ),
        }));
        return saved;
      } catch (err) {
        URL.revokeObjectURL(preview);
        patchThread(thread.id, (t) => ({
          ...t,
          messages: (t.messages || []).filter((m) => m.id !== tempId),
        }));
        throw err;
      }
    },
    [clearMyTyping, patchThread],
  );

  /** Edit one of my text messages; the peer sees it on their next poll. */
  const editMessage = useCallback(
    async (messageId, text) => {
      const thread = threadsRef.current.find((t) => t.id === activeIdRef.current) || null;
      const trimmed = String(text || '').trim();
      if (!trimmed || !thread) return null;

      const saved = await api.editMessage(thread.id, messageId, trimmed, thread);
      patchThread(thread.id, (t) => ({
        ...t,
        messages: mergeMessages(t.messages, [saved]),
      }));
      return saved;
    },
    [patchThread],
  );

  /** scope 'me' hides locally; scope 'all' tombstones for both parties. */
  const deleteMessage = useCallback(
    async (messageId, scope = 'me') => {
      const thread = threadsRef.current.find((t) => t.id === activeIdRef.current) || null;
      if (!thread) return null;

      // Local-only optimism for pending sends that never reached the server
      if (String(messageId).startsWith('local_')) {
        patchThread(thread.id, (t) => ({
          ...t,
          messages: (t.messages || []).filter((m) => m.id !== messageId),
        }));
        return null;
      }

      const saved = await api.deleteMessage(thread.id, messageId, scope);
      patchThread(thread.id, (t) => ({
        ...t,
        messages: mergeMessages(t.messages, [saved]),
      }));
      return saved;
    },
    [patchThread],
  );

  const confirmDeal = useCallback(async () => {
    const thread = threadsRef.current.find((t) => t.id === activeIdRef.current);
    if (!thread) return null;
    if (thread.pendingSellerKeys || String(thread.id).startsWith('pending_')) return null;
    if (thread.iConfirmed || thread.sold) return thread;

    const updated = await api.confirmDeal(thread.id);
    patchThread(thread.id, (t) => ({
      ...t,
      status: updated.status,
      buyerConfirmed: updated.buyerConfirmed,
      sellerConfirmed: updated.sellerConfirmed,
      iConfirmed: updated.iConfirmed,
      peerConfirmed: updated.peerConfirmed,
      sold: updated.sold,
      listing: updated.listing || t.listing,
      listingLive: updated.listingLive,
      tradeClosed: updated.tradeClosed,
      canTrade: updated.canTrade,
      listingRemaining: updated.listingRemaining,
      listingFullySold: updated.listingFullySold,
    }));
    setDealDone(!!updated.iConfirmed);
    return updated;
  }, [patchThread]);

  /* Live poll: new messages + peer typing indicator. */
  useEffect(() => {
    if (!activeId || String(activeId).startsWith('pending_')) {
      setTyping(false);
      return undefined;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled || pollBusy.current || document.hidden) return;
      const id = activeIdRef.current;
      if (!id || String(id).startsWith('pending_')) return;
      const thread = threadsRef.current.find((t) => t.id === id);
      if (!thread || thread.pendingSellerKeys) return;

      pollBusy.current = true;
      try {
        const after = lastMessageAt(thread.messages);
        const [newer, peerTyping, meta] = await Promise.all([
          api.pollMessages(id, after, thread),
          api.getPeerTyping(id).catch(() => false),
          api.getThread(id).catch(() => null),
        ]);
        if (cancelled) return;

        setTyping(!!peerTyping);
        setPeerOnline(true);

        if (meta) {
          setDealDone(!!(meta.iConfirmed || meta.sold));
          patchThread(id, (t) => ({
            ...t,
            status: meta.status,
            // Keep the displayed quantity current — the Confirm button must
            // never authorise terms the server has since changed.
            qty: meta.qty ?? t.qty,
            buyerConfirmed: meta.buyerConfirmed,
            sellerConfirmed: meta.sellerConfirmed,
            iConfirmed: meta.iConfirmed,
            peerConfirmed: meta.peerConfirmed,
            sold: meta.sold,
            listing: meta.listing || t.listing,
            listingLive: meta.listingLive,
            tradeClosed: meta.tradeClosed,
            canTrade: meta.canTrade,
          }));
        }

        if (newer.length) {
          const hasPeer = newer.some((m) => m.from === 'them');
          patchThread(id, (t) => ({
            ...t,
            unreadCount: 0,
            messages: mergeMessages(t.messages, newer).map((m) =>
              m.from === 'them' ? { ...m, read: true } : m,
            ),
          }));
          if (hasPeer) await markThreadSeen(id);
        }
      } catch {
        /* keep polling */
      } finally {
        pollBusy.current = false;
      }
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      clearMyTyping();
    };
  }, [activeId, clearMyTyping, markThreadSeen, patchThread]);

  /* Refresh thread list + unread counts often enough for the chat badge. */
  useEffect(() => {
    if (!cryptoReady) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [cryptoReady, refresh]);

  const unreadTotal = threads.reduce((n, t) => n + (Number(t.unreadCount) || 0), 0);

  return {
    threads,
    active,
    activeId: active?.id ?? null,
    loading,
    typing,
    peerOnline,
    dealDone,
    cryptoReady,
    error,
    unreadTotal,
    seed,
    reset,
    refresh,
    openThread,
    startPurchase,
    send,
    sendImage,
    editMessage,
    deleteMessage,
    notifyTyping,
    confirmDeal,
  };
}
