import { threadExpiresAt } from './chat-expiry.js';
import { toListing } from './tickets.js';

const THREAD_SELECT = `
  id, listing_id, buyer_id, seller_id, qty, status, created_at, updated_at,
  buyer_wrapped_key, seller_wrapped_key,
  buyer_confirmed_at, seller_confirmed_at,
  listing:tickets!listing_id (
    id, movie, theatre, show_time, price, qty, seat, note, status, created_at, seller_id,
    users!seller_id ( username )
  ),
  buyer:users!buyer_id ( id, username ),
  seller:users!seller_id ( id, username )
`;

export { THREAD_SELECT };

export function shapeThread(row, meId, unreadCount = 0) {
  const listing = row.listing ? toListing(row.listing) : null;
  const buyerName = row.buyer?.username || '';
  const sellerName = row.seller?.username || '';
  const iAmBuyer = row.buyer_id === meId;
  const buyerConfirmed = !!row.buyer_confirmed_at;
  const sellerConfirmed = !!row.seller_confirmed_at;
  const sold = row.status === 'confirmed';
  const listingStatus = listing?.status || null;
  const listingLive = listingStatus === 'live';
  const tradeClosed =
    row.status === 'closed' || listingStatus === 'withdrawn' || listingStatus === 'sold';

  return {
    id: row.id,
    listingId: row.listing_id,
    listing,
    qty: row.qty,
    status: row.status,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    with: iAmBuyer ? sellerName : buyerName,
    role: iAmBuyer ? 'buyer' : 'seller',
    wrappedKey: iAmBuyer ? row.buyer_wrapped_key : row.seller_wrapped_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: threadExpiresAt(row.created_at),
    buyerConfirmed,
    sellerConfirmed,
    iConfirmed: iAmBuyer ? buyerConfirmed : sellerConfirmed,
    peerConfirmed: iAmBuyer ? sellerConfirmed : buyerConfirmed,
    sold,
    listingLive,
    tradeClosed,
    canTrade: !sold && listingLive && row.status === 'open',
    unreadCount: Number(unreadCount) || 0,
    messages: [],
  };
}
