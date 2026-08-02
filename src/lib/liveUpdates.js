/**
 * Live marketplace updates over Supabase Realtime (WSS).
 *
 * The socket only ever carries a signal — { id, status } — never listing rows.
 * On each event the caller re-reads through the normal authenticated API, so
 * the HTTP layer stays the single authorization boundary and the browser key
 * needs no read access to any table.
 *
 * Falls back silently to the existing polling behaviour when the publishable
 * key is not configured.
 */

// RealtimeClient directly rather than createClient(): the full SDK also pulls
// in postgrest, auth, storage and functions, none of which the browser uses.
import { RealtimeClient } from '@supabase/realtime-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const LISTINGS_TOPIC = 'listings';

/** Collapse bursts (e.g. a multi-seat sale) into one refetch. */
const COALESCE_MS = 250;

let client = null;

function getClient() {
  if (!URL || !KEY) return null;
  if (!client) {
    // https://… → wss://… ; subscribe() opens the socket on demand
    const socketUrl = `${String(URL).replace(/^http/, 'ws')}/realtime/v1`;
    client = new RealtimeClient(socketUrl, {
      params: { apikey: KEY, eventsPerSecond: 10 },
    });
  }
  return client;
}

/**
 * Subscribe to listing changes.
 * @param {(payload: {id?: string, status?: string, reason?: string}) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeToListings(onChange) {
  const supabase = getClient();
  if (!supabase) return () => {};

  let timer = null;
  let latest = null;

  const flush = () => {
    timer = null;
    const payload = latest;
    latest = null;
    try {
      onChange(payload || {});
    } catch {
      /* a failed refetch must not tear down the socket */
    }
  };

  const channel = supabase
    .channel(LISTINGS_TOPIC)
    .on('broadcast', { event: 'changed' }, ({ payload }) => {
      latest = payload || {};
      if (timer) return;
      timer = setTimeout(flush, COALESCE_MS);
    })
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    channel.unsubscribe();
    supabase.removeChannel(channel);
  };
}
