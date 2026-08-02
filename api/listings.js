import { getAuthUser } from './_lib/auth-request.js';
import { allowMethods, readJson, sendError, sendJson } from './_lib/http.js';
import { broadcastListingChange } from './_lib/realtime.js';
import { getSupabase } from './_lib/supabase.js';
import { toListing, validateTicketPayload } from './_lib/tickets.js';

const SELECT =
  'id, movie, theatre, show_time, price, qty, seat, note, status, created_at, seller_id, users!seller_id ( username )';

export default async function handler(req, res) {
  const method = (req.method || '').toUpperCase();
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  try {
    if (method === 'GET') return await listTickets(req, res);
    return await createTicket(req, res);
  } catch (err) {
    console.error('[listings]', err);
    const message = err.message?.includes('Missing ')
      ? 'Server is not configured'
      : 'Could not process listings request';
    return sendError(res, 500, message);
  }
}

async function soldQtyByListing(supabase, listingIds) {
  const map = Object.fromEntries(listingIds.map((id) => [id, 0]));
  if (!listingIds.length) return map;

  const { data, error } = await supabase
    .from('chat_threads')
    .select('listing_id, qty')
    .in('listing_id', listingIds)
    .eq('status', 'confirmed');

  if (error) {
    console.error('[listings sold qty]', error);
    return map;
  }

  for (const row of data || []) {
    map[row.listing_id] = (map[row.listing_id] || 0) + (Number(row.qty) || 0);
  }
  return map;
}

function withSaleStats(listing, soldQty) {
  const sold = Number(soldQty) || 0;
  const stock = Number(listing.qty) || 0;
  // Fully sold rows keep qty at 0 — listed total is what was sold
  const remaining = listing.status === 'sold' ? 0 : stock;
  const listedQty = Math.max(sold + remaining, sold, stock, 1);
  const fullySold = remaining === 0 && sold > 0 && sold >= listedQty;
  const canDelete = listing.status === 'live' && remaining > 0;

  return {
    ...listing,
    soldQty: sold,
    listedQty,
    remainingQty: remaining,
    fullySold,
    canDelete,
  };
}

async function listTickets(req, res) {
  const supabase = getSupabase();
  const host = req.headers?.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const mine = url.searchParams.get('mine') === '1';

  let query = supabase
    .from('tickets')
    .select(SELECT)
    .order('created_at', { ascending: false });

  if (mine) {
    const user = getAuthUser(req);
    if (!user) return sendError(res, 401, 'Log in to view your listings');
    // Seller history: live, fully sold, and withdrawn leftovers that had sales
    query = query.eq('seller_id', user.id).in('status', ['live', 'sold', 'withdrawn']);
  } else {
    query = query.eq('status', 'live');
  }

  const { data, error } = await query;
  if (error) {
    console.error('[listings GET]', error);
    return sendError(res, 500, 'Failed to load listings');
  }

  const rows = (data || []).map(toListing);

  if (!mine) {
    return sendJson(res, 200, rows);
  }

  const soldMap = await soldQtyByListing(
    supabase,
    rows.map((r) => r.id),
  );

  const enriched = rows
    .map((row) => withSaleStats(row, soldMap[row.id] || 0))
    // Keep withdrawn only when something was sold (0/Y deleted listings drop out)
    .filter((row) => row.status !== 'withdrawn' || row.soldQty > 0);

  return sendJson(res, 200, enriched);
}

async function createTicket(req, res) {
  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in to post a ticket');

  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendError(res, 400, 'Invalid JSON body');
  }

  const parsed = validateTicketPayload(body);
  if (parsed.error) return sendError(res, 400, parsed.error);

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      seller_id: user.id,
      ...parsed.value,
      status: 'live',
    })
    .select(SELECT)
    .single();

  if (error) {
    console.error('[listings POST]', error);
    return sendError(res, 500, 'Failed to post ticket');
  }

  await broadcastListingChange({ id: data.id, status: 'live', reason: 'created' });

  return sendJson(res, 201, withSaleStats(toListing(data), 0));
}
