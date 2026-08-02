/** Map a tickets row (+ joined user) to the shape the UI expects. */
export function toListing(row) {
  const seller =
    row.seller ||
    row.users?.username ||
    (typeof row.users === 'object' && row.users !== null ? row.users.username : null) ||
    '';

  return {
    id: row.id,
    movie: row.movie,
    theatre: row.theatre,
    showTime: row.show_time || row.showTime,
    seller,
    sellerId: row.seller_id || row.sellerId || row.users?.id,
    price: Number(row.price),
    qty: Number(row.qty),
    seat: row.seat,
    note: row.note || '',
    status: row.status || 'live',
    createdAt: row.created_at || row.createdAt,
  };
}

export function validateTicketPayload(body) {
  const movie = String(body.movie || '').trim();
  const theatre = String(body.theatre || '').trim();
  const seat = String(body.seat || 'Regular').trim() || 'Regular';
  const note = String(body.note || '').trim();
  const price = Number(body.price);
  const qty = Number(body.qty);
  const showTime = body.showTime || body.show_time;

  if (!movie) return { error: 'Movie name is required' };
  if (!theatre) return { error: 'Theatre is required' };
  if (!showTime || Number.isNaN(new Date(showTime).getTime())) {
    return { error: 'Valid show date and time is required' };
  }
  if (!(price > 0) || !Number.isFinite(price)) return { error: 'Price must be greater than 0' };
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    return { error: 'Quantity must be between 1 and 10' };
  }

  return {
    value: {
      movie,
      theatre,
      show_time: new Date(showTime).toISOString(),
      price: Math.round(price),
      qty,
      seat,
      note,
    },
  };
}
