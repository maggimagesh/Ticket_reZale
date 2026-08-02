import { getAuthUser } from '../_lib/auth-request.js';
import { allowMethods, sendError, sendJson } from '../_lib/http.js';
import { broadcastListingChange } from '../_lib/realtime.js';
import { getSupabase } from '../_lib/supabase.js';

function listingIdFrom(req) {
  if (req.params?.id) return req.params.id;
  if (req.query?.id) return Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const host = req.headers?.host || 'localhost';
  try {
    const parts = new URL(req.url || '/', `http://${host}`).pathname.split('/').filter(Boolean);
    // /api/listings/:id
    return parts[2] || null;
  } catch {
    return null;
  }
}

/**
 * DELETE /api/listings/:id — seller withdraws listing (soft delete).
 * Keeps the row so buyer/seller chats are not cascade-deleted.
 */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['DELETE'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  const id = listingIdFrom(req);
  if (!id) return sendError(res, 400, 'Listing id required');

  try {
    const supabase = getSupabase();
    const { data: row, error: lookupErr } = await supabase
      .from('tickets')
      .select('id, seller_id, status')
      .eq('id', id)
      .maybeSingle();

    if (lookupErr) {
      console.error('[listings delete lookup]', lookupErr);
      return sendError(res, 500, 'Could not delete listing');
    }
    if (!row) return sendError(res, 404, 'Listing not found');
    if (row.seller_id !== user.id) {
      return sendError(res, 403, 'Only the seller can delete this listing');
    }
    if (row.status === 'withdrawn') {
      return sendJson(res, 200, { ok: true, id });
    }
    if (row.status === 'sold') {
      return sendError(res, 400, 'Fully sold listings stay in your history');
    }

    // Soft-delete: hard delete would CASCADE wipe chat_threads + messages
    const { data: updated, error } = await supabase
      .from('tickets')
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .eq('seller_id', user.id)
      .eq('status', 'live')
      .select('id, qty, status')
      .maybeSingle();

    if (error) {
      console.error('[listings delete]', error);
      return sendError(res, 500, 'Could not delete listing');
    }
    if (!updated) return sendError(res, 404, 'Listing not found');

    // Close open negotiations so neither party keeps buying a gone listing
    const { error: closeErr } = await supabase
      .from('chat_threads')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('listing_id', id)
      .eq('status', 'open');

    if (closeErr) {
      console.error('[listings delete close threads]', closeErr);
    }

    await broadcastListingChange({ id, status: 'withdrawn', reason: 'withdrawn' });

    return sendJson(res, 200, { ok: true, id, status: 'withdrawn' });
  } catch (err) {
    console.error('[listings delete]', err);
    return sendError(res, 500, 'Could not delete listing');
  }
}
