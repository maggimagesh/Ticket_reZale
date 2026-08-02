import { getAuthUser } from '../../_lib/auth-request.js';
import { assertThreadAccess } from '../../_lib/chat-access.js';
import { shapeThread, THREAD_SELECT } from '../../_lib/chat-thread.js';
import { allowMethods, readJson, sendError, sendJson } from '../../_lib/http.js';
import { broadcastListingChange } from '../../_lib/realtime.js';
import { getSupabase } from '../../_lib/supabase.js';

function threadIdFrom(req) {
  if (req.params?.id) return req.params.id;
  if (req.query?.id) return Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const host = req.headers?.host || 'localhost';
  try {
    return new URL(req.url || '/', `http://${host}`).searchParams.get('id');
  } catch {
    return null;
  }
}

/**
 * GET   /api/chat/threads/:id
 * PATCH /api/chat/threads/:id
 *   { confirm: true } — party confirms; when both confirm, listing qty decreases
 *                       (sold only when remaining qty hits 0)
 *   { status: 'closed' } — close without sale
 */
export default async function handler(req, res) {
  const method = (req.method || '').toUpperCase();
  if (!allowMethods(req, res, ['GET', 'PATCH'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  const id = threadIdFrom(req);
  if (!id) return sendError(res, 400, 'Thread id required');

  try {
    const supabase = getSupabase();
    const access = await assertThreadAccess(supabase, id, user.id, { select: THREAD_SELECT });
    if (!access.ok) return sendError(res, access.status, access.error);
    const row = access.thread;

    if (method === 'GET') {
      return sendJson(res, 200, shapeThread(row, user.id));
    }

    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    if (body.confirm === true) {
      return await confirmParty(supabase, res, row, user);
    }

    const status = String(body.status || '').trim();
    if (status !== 'closed') {
      return sendError(res, 400, 'Use { confirm: true } to confirm, or status: closed');
    }

    const { data: updated, error } = await supabase
      .from('chat_threads')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(THREAD_SELECT)
      .single();

    if (error) {
      console.error('[chat/thread patch]', error);
      return sendError(res, 500, 'Could not update conversation');
    }

    return sendJson(res, 200, shapeThread(updated, user.id));
  } catch (err) {
    console.error('[chat/thread]', err);
    return sendError(res, 500, 'Chat request failed');
  }
}

async function confirmParty(supabase, res, row, user) {
  if (row.status === 'confirmed') {
    return sendJson(res, 200, shapeThread(row, user.id));
  }
  if (row.status === 'closed') {
    return sendError(res, 400, 'This conversation is closed — listing was removed');
  }

  const iAmBuyer = row.buyer_id === user.id;

  // Seller can only confirm after the buyer clicks Confirm purchase
  if (!iAmBuyer && !row.buyer_confirmed_at) {
    return sendError(res, 400, 'Wait for the buyer to confirm purchase first');
  }

  // Listing must still be for sale
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, status')
    .eq('id', row.listing_id)
    .maybeSingle();

  if (!ticket || ticket.status !== 'live') {
    return sendError(res, 400, 'This listing is no longer for sale');
  }

  const patch = {
    updated_at: new Date().toISOString(),
    ...(iAmBuyer
      ? { buyer_confirmed_at: row.buyer_confirmed_at || new Date().toISOString() }
      : { seller_confirmed_at: row.seller_confirmed_at || new Date().toISOString() }),
  };

  const buyerOk = iAmBuyer ? true : !!row.buyer_confirmed_at;
  const sellerOk = !iAmBuyer ? true : !!row.seller_confirmed_at;
  const both = buyerOk && sellerOk;

  let applied = null;
  if (both) {
    // Decrement stock before marking the thread confirmed
    applied = await applyPurchaseToListing(supabase, row);
    if (!applied.ok) {
      return sendError(res, applied.status || 500, applied.error);
    }
    patch.status = 'confirmed';
  }

  const { data: updated, error } = await supabase
    .from('chat_threads')
    .update(patch)
    .eq('id', row.id)
    .select(THREAD_SELECT)
    .single();

  if (error) {
    console.error('[chat/thread confirm]', error);
    // Stock moved but the thread never settled. Without a transaction the
    // retry would decrement a second time, so undo it here.
    if (both && applied?.decremented) {
      await restoreListingStock(supabase, row.listing_id, applied);
    }
    return sendError(res, 500, 'Could not confirm deal');
  }

  if (both && applied) {
    const access = await assertThreadAccess(supabase, row.id, user.id, { select: THREAD_SELECT });
    if (access.ok) {
      return sendJson(res, 200, {
        ...shapeThread(access.thread, user.id),
        listingRemaining: applied.remaining,
        listingFullySold: applied.fullySold,
      });
    }
  }

  return sendJson(res, 200, shapeThread(updated, user.id));
}

/** Reduce listing qty by the thread purchase; mark sold only when none left. */
async function applyPurchaseToListing(supabase, thread) {
  const buyQty = Number(thread.qty) || 0;
  if (buyQty < 1) {
    return { ok: false, status: 400, error: 'Invalid purchase quantity' };
  }

  const { data: ticket, error: lookupErr } = await supabase
    .from('tickets')
    .select('id, qty, status')
    .eq('id', thread.listing_id)
    .maybeSingle();

  if (lookupErr) {
    console.error('[chat/thread listing lookup]', lookupErr);
    return { ok: false, status: 500, error: 'Could not update listing stock' };
  }
  if (!ticket) {
    return { ok: false, status: 404, error: 'Listing not found' };
  }

  // Already fully sold by another deal — still allow this thread to finish
  if (ticket.status !== 'live') {
    return { ok: true, remaining: 0, fullySold: true, decremented: false };
  }

  const available = Number(ticket.qty) || 0;
  if (available < buyQty) {
    return {
      ok: false,
      status: 409,
      error: `Only ${available} ticket${available === 1 ? '' : 's'} left on this listing`,
    };
  }

  const remaining = available - buyQty;
  const ticketPatch =
    remaining <= 0 ? { qty: 0, status: 'sold' } : { qty: remaining, status: 'live' };

  const { data: stocked, error: ticketErr } = await supabase
    .from('tickets')
    .update(ticketPatch)
    .eq('id', thread.listing_id)
    .eq('status', 'live')
    .eq('qty', available) // optimistic lock against concurrent sales
    .select('id, qty, status')
    .maybeSingle();

  if (ticketErr) {
    console.error('[chat/thread stock]', ticketErr);
    return { ok: false, status: 500, error: 'Could not update listing stock' };
  }
  if (!stocked) {
    return {
      ok: false,
      status: 409,
      error: 'Listing stock changed — refresh and try confirming again',
    };
  }

  // Stock changed; notify open marketplace views.
  await broadcastListingChange({
    id: thread.listing_id,
    status: stocked.status,
    remaining: Number(stocked.qty) || 0,
    reason: 'sold',
  });

  return {
    ok: true,
    remaining: Number(stocked.qty) || 0,
    fullySold: stocked.status === 'sold' || (Number(stocked.qty) || 0) <= 0,
    // Rollback bookkeeping for a failed settle
    decremented: true,
    previousQty: available,
    previousStatus: 'live',
  };
}

/** Undo a stock decrement whose thread never reached `confirmed`. */
async function restoreListingStock(supabase, listingId, applied) {
  const { error } = await supabase
    .from('tickets')
    .update({ qty: applied.previousQty, status: applied.previousStatus })
    .eq('id', listingId)
    .eq('qty', applied.remaining) // only if nothing else moved stock since
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[chat/thread stock rollback]', error);
  }
}
