import { allowMethods, sendError, sendJson } from './_lib/http.js';
import { getSupabase } from './_lib/supabase.js';

/** GET /api/theatres — Chennai-area cinema names for the sell dropdown. */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const supabase = getSupabase();
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const q = (url.searchParams.get('q') || '').trim().replace(/[%_,]/g, ' ');

    let query = supabase
      .from('theatres')
      .select('id, name, area, seat_types')
      .lte('distance_km', 50)
      .order('distance_km', { ascending: true })
      .order('name', { ascending: true });

    if (q) {
      query = query.or(`name.ilike.%${q}%,area.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[theatres GET]', error);
      return sendError(res, 500, 'Failed to load theatres');
    }

    const rows = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      area: row.area,
      seatTypes: Array.isArray(row.seat_types) && row.seat_types.length
        ? row.seat_types
        : ['Regular'],
    }));

    return sendJson(res, 200, rows);
  } catch (err) {
    console.error('[theatres]', err);
    const message = err.message?.includes('Missing ')
      ? 'Server is not configured'
      : 'Failed to load theatres';
    return sendError(res, 500, message);
  }
}
