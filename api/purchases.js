import { getAuthUser } from './_lib/auth-request.js';
import { THREAD_SELECT } from './_lib/chat-thread.js';
import { allowMethods, sendError, sendJson } from './_lib/http.js';
import { getSupabase } from './_lib/supabase.js';
import { toListing } from './_lib/tickets.js';

/**
 * GET /api/purchases — tickets this user bought (confirmed deals as buyer)
 */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  const user = getAuthUser(req);
  if (!user) return sendError(res, 401, 'Log in required');

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('chat_threads')
      .select(THREAD_SELECT)
      .eq('buyer_id', user.id)
      .eq('status', 'confirmed')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[purchases GET]', error);
      return sendError(res, 500, 'Failed to load purchases');
    }

    const purchases = (data || []).map((row) => {
      const listing = row.listing ? toListing(row.listing) : null;
      const sellerName = row.seller?.username || listing?.seller || '';
      const qty = Number(row.qty) || 0;
      const price = Number(listing?.price) || 0;
      return {
        id: row.id,
        listingId: row.listing_id,
        movie: listing?.movie || 'Ticket',
        theatre: listing?.theatre || '',
        showTime: listing?.showTime || null,
        seat: listing?.seat || '',
        note: listing?.note || '',
        seller: sellerName,
        sellerId: row.seller_id,
        qty,
        price,
        total: qty * price,
        purchasedAt: row.updated_at || row.buyer_confirmed_at || row.created_at,
        status: 'Purchased',
      };
    });

    return sendJson(res, 200, purchases);
  } catch (err) {
    console.error('[purchases]', err);
    return sendError(
      res,
      500,
      err.message?.includes('Missing ') ? 'Server is not configured' : 'Failed to load purchases',
    );
  }
}
