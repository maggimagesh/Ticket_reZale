import { getAuthUser } from '../auth-request.js';
import { purgeExpiredChats } from '../chat-expiry.js';
import { shapeThread, THREAD_SELECT } from '../chat-thread.js';
import { allowMethods, readJson, sendError, sendJson } from '../http.js';
import { getSupabase } from '../supabase.js';

/**
 * GET  /api/chat/threads — my threads
 * POST /api/chat/threads — open/reuse negotiation (buyer); body includes wrapped keys
 */
export default async function route(req, res) {
  const method = (req.method || '').toUpperCase();
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  try {
    if (method === 'GET') return await listThreads(req, res, user);
    return await createThread(req, res, user);
  } catch (err) {
    console.error('[chat/threads]', err);
    return sendError(res, 500, err.message?.includes('Missing ') ? 'Server is not configured' : 'Chat request failed');
  }
}

async function unreadCountsByThread(supabase, threadIds, userId) {
  const counts = Object.fromEntries(threadIds.map((id) => [id, 0]));
  if (!threadIds.length) return counts;

  const { data, error } = await supabase
    .from('chat_messages')
    .select('thread_id')
    .in('thread_id', threadIds)
    .neq('sender_id', userId)
    .is('read_at', null);

  if (error) {
    console.error('[chat/threads unread]', error);
    return counts;
  }

  for (const row of data || []) {
    counts[row.thread_id] = (counts[row.thread_id] || 0) + 1;
  }
  return counts;
}

async function listThreads(req, res, user) {
  const supabase = getSupabase();
  await purgeExpiredChats(supabase);

  const { data, error } = await supabase
    .from('chat_threads')
    .select(THREAD_SELECT)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[chat/threads list]', error);
    return sendError(res, 500, 'Could not load conversations');
  }

  const rows = data || [];
  const counts = await unreadCountsByThread(
    supabase,
    rows.map((r) => r.id),
    user.id,
  );

  return sendJson(
    res,
    200,
    rows.map((row) => shapeThread(row, user.id, counts[row.id] || 0)),
  );
}

async function createThread(req, res, user) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendError(res, 400, 'Invalid JSON body');
  }

  const listingId = String(body.listingId || '').trim();
  const qty = Number(body.qty);
  const buyerWrappedKey = body.buyerWrappedKey;
  const sellerWrappedKey = body.sellerWrappedKey;

  if (!listingId) return sendError(res, 400, 'listingId is required');
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) return sendError(res, 400, 'Invalid quantity');
  if (!buyerWrappedKey || !sellerWrappedKey) {
    return sendError(res, 400, 'E2E wrapped keys are required for both parties');
  }

  const supabase = getSupabase();
  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select('id, seller_id, qty, status, movie, theatre, show_time, price, seat, note, created_at, users!seller_id ( username )')
    .eq('id', listingId)
    .maybeSingle();

  if (ticketErr) {
    console.error('[chat/threads ticket]', ticketErr);
    return sendError(res, 500, 'Could not load listing');
  }
  if (!ticket || ticket.status !== 'live') return sendError(res, 404, 'Listing not available');
  if (ticket.seller_id === user.id) return sendError(res, 400, 'You cannot buy your own listing');
  if (qty > ticket.qty) return sendError(res, 400, 'Not enough tickets available');

  const { data: existing } = await supabase
    .from('chat_threads')
    .select(THREAD_SELECT)
    .eq('listing_id', listingId)
    .eq('buyer_id', user.id)
    .maybeSingle();

  if (existing) {
    // A settled deal is immutable — reopening it must not rewrite the agreed
    // quantity. Hand back the thread unchanged so the chat still opens.
    if (existing.status !== 'open' || Number(existing.qty) === qty) {
      return sendJson(res, 200, shapeThread(existing, user.id));
    }

    // Changing the quantity changes the terms, so neither party has agreed to
    // the new deal yet — both confirmations are voided.
    const { data: updated, error: updErr } = await supabase
      .from('chat_threads')
      .update({
        qty,
        buyer_confirmed_at: null,
        seller_confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('status', 'open')
      .select(THREAD_SELECT)
      .maybeSingle();
    if (updErr) {
      console.error('[chat/threads reuse]', updErr);
      return sendError(res, 500, 'Could not open conversation');
    }
    // Lost the race to a concurrent confirm — return the settled thread as-is.
    if (!updated) {
      return sendJson(res, 200, shapeThread(existing, user.id));
    }
    return sendJson(res, 200, shapeThread(updated, user.id));
  }

  const { data: created, error: insErr } = await supabase
    .from('chat_threads')
    .insert({
      listing_id: listingId,
      buyer_id: user.id,
      seller_id: ticket.seller_id,
      qty,
      status: 'open',
      buyer_wrapped_key: typeof buyerWrappedKey === 'string' ? buyerWrappedKey : JSON.stringify(buyerWrappedKey),
      seller_wrapped_key: typeof sellerWrappedKey === 'string' ? sellerWrappedKey : JSON.stringify(sellerWrappedKey),
    })
    .select(THREAD_SELECT)
    .single();

  if (insErr) {
    console.error('[chat/threads create]', insErr);
    return sendError(res, 500, 'Could not start encrypted chat');
  }

  return sendJson(res, 201, shapeThread(created, user.id));
}
