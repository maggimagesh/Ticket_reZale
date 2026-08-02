import { rankMovies } from './_lib/fuzzy.js';
import { allowMethods, sendError, sendJson } from './_lib/http.js';
import { getSupabase } from './_lib/supabase.js';
import { ensureMoviesFresh, searchTmdb, toMovieDto } from './_lib/tmdb.js';

/**
 * GET /api/movies
 * GET /api/movies?q=spideman
 *
 * Catalog refreshes from TMDB (~every 12h). Typing searches the cache with
 * fuzzy matching, then TMDB search if needed — so new releases stay discoverable.
 */
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const q = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(Number(url.searchParams.get('limit')) || 12, 25);

    await ensureMoviesFresh();

    const supabase = getSupabase();

    if (!q) {
      const { data, error } = await supabase
        .from('movies')
        .select('tmdb_id, title, original_title, release_date, popularity')
        .order('popularity', { ascending: false })
        .limit(40);

      if (error) {
        console.error('[movies GET]', error);
        return sendError(res, 500, 'Failed to load movies');
      }
      return sendJson(res, 200, (data || []).slice(0, limit).map(toMovieDto));
    }

    // Broad pull from cache, then fuzzy-rank in process (handles typos / formatting).
    const { data: cached, error } = await supabase
      .from('movies')
      .select('tmdb_id, title, original_title, release_date, popularity')
      .order('popularity', { ascending: false })
      .limit(250);

    if (error) {
      console.error('[movies search cache]', error);
      return sendError(res, 500, 'Failed to search movies');
    }

    let ranked = rankMovies(q, cached || [], limit);

    if (ranked.length < 5) {
      try {
        const remote = await searchTmdb(q);
        const merged = new Map();
        for (const row of [...(cached || []), ...remote]) {
          merged.set(row.tmdb_id, row);
        }
        ranked = rankMovies(q, [...merged.values()], limit);
      } catch (err) {
        console.error('[movies TMDB search]', err.message);
      }
    }

    return sendJson(res, 200, ranked.map(toMovieDto));
  } catch (err) {
    console.error('[movies]', err);
    const message = err.message?.includes('Missing ')
      ? 'Movie search is not configured (set TMDB_API_KEY)'
      : 'Failed to load movies';
    return sendError(res, 500, message);
  }
}
