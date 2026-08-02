/**
 * Server → browser push for listing changes.
 *
 * Deliberately carries a signal, not data: the payload is only an id plus a
 * public status, and clients re-read the real rows through /api/listings.
 * That keeps the HTTP API as the single authorization boundary and means the
 * tickets table needs no anon read grant.
 *
 * Uses Supabase Realtime's HTTP broadcast endpoint so it works from a
 * serverless function, which cannot hold a socket open.
 */

export const LISTINGS_TOPIC = 'listings';
const BROADCAST_EVENT = 'changed';

/**
 * Fire-and-forget. A broadcast failure must never fail the request that
 * triggered it — clients still poll and will converge on their own.
 */
export async function broadcastListingChange(payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: LISTINGS_TOPIC,
            event: BROADCAST_EVENT,
            payload: { ...payload, at: Date.now() },
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error('[realtime broadcast]', res.status, (await res.text()).slice(0, 160));
    }
  } catch (err) {
    console.error('[realtime broadcast]', err.message);
  }
}
