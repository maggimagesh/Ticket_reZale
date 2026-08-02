import { getSupabase } from './supabase.js';

const TMDB = 'https://api.themoviedb.org/3';
const STALE_MS = 12 * 60 * 60 * 1000; // refresh catalog about twice a day

function tmdbKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('Missing TMDB_API_KEY');
  return key;
}

async function tmdb(path, params = {}) {
  const url = new URL(TMDB + path);
  url.searchParams.set('api_key', tmdbKey());
  url.searchParams.set('language', 'en-IN');
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json();
}

function mapResult(item) {
  return {
    tmdb_id: item.id,
    title: String(item.title || item.name || '').trim(),
    original_title: String(item.original_title || item.original_name || '').trim(),
    release_date: item.release_date || null,
    popularity: Number(item.popularity) || 0,
    poster_path: item.poster_path || null,
    synced_at: new Date().toISOString(),
  };
}

async function upsertMovies(rows) {
  const clean = rows.filter((r) => r.tmdb_id && r.title);
  if (!clean.length) return;
  const supabase = getSupabase();
  const { error } = await supabase.from('movies').upsert(clean, { onConflict: 'tmdb_id' });
  if (error) throw error;
}

/** Pull now-playing, upcoming, and popular (India) into Supabase. */
export async function syncMoviesFromTmdb() {
  const [nowPlaying, upcoming, popular] = await Promise.all([
    tmdb('/movie/now_playing', { region: 'IN', page: 1 }),
    tmdb('/movie/upcoming', { region: 'IN', page: 1 }),
    tmdb('/movie/popular', { region: 'IN', page: 1 }),
  ]);

  const byId = new Map();
  for (const block of [nowPlaying.results, upcoming.results, popular.results]) {
    for (const item of block || []) {
      const row = mapResult(item);
      if (row.title) byId.set(row.tmdb_id, row);
    }
  }

  await upsertMovies([...byId.values()]);
  return byId.size;
}

export async function searchTmdb(query) {
  const data = await tmdb('/search/movie', {
    query,
    region: 'IN',
    include_adult: 'false',
    page: 1,
  });
  const rows = (data.results || []).map(mapResult).filter((r) => r.title);
  await upsertMovies(rows);
  return rows;
}

/** Refresh catalog when empty or older than STALE_MS. */
export async function ensureMoviesFresh() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('movies')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const latest = data?.synced_at ? new Date(data.synced_at).getTime() : 0;
  const stale = !latest || Date.now() - latest > STALE_MS;

  if (stale) {
    try {
      await syncMoviesFromTmdb();
    } catch (err) {
      // Keep serving whatever we already cached if TMDB is down.
      if (!latest) throw err;
      console.error('[movies] sync failed, using cache', err.message);
    }
  }
}

export function toMovieDto(row) {
  const year = row.release_date ? String(row.release_date).slice(0, 4) : '';
  return {
    title: row.title,
    originalTitle: row.original_title || '',
    year: year && year !== 'null' ? year : null,
    tmdbId: row.tmdb_id,
    popularity: row.popularity,
    label: year && year !== 'null' ? `${row.title} (${year})` : row.title,
  };
}
