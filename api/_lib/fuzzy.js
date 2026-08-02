/** Normalize for fuzzy compare: "Spider-Man!" / "spiderman" → "spiderman" */
export function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cur = a[i] === b[j] ? row[j] : Math.min(row[j], row[j + 1], prev) + 1;
      row[j] = prev;
      prev = cur;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Score how well `query` matches a movie title (higher is better).
 * Handles case, punctuation, partials, and light typos ("Spideman").
 */
function scoreMovieMatch(query, title, originalTitle = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 1;

  const nq = normalizeTitle(q);
  const candidates = [title, originalTitle].filter(Boolean);
  let best = 0;

  for (const raw of candidates) {
    const lower = String(raw).toLowerCase();
    const nt = normalizeTitle(raw);
    if (!nt) continue;

    if (nt === nq) best = Math.max(best, 1000);
    else if (nt.startsWith(nq)) best = Math.max(best, 900 - (nt.length - nq.length));
    else if (nt.includes(nq)) best = Math.max(best, 700 - (nt.indexOf(nq) || 0));

    // Prefix typos against the compacted title: "Spideman" ≈ "spiderman…"
    if (nq.length >= 4 && nt.length >= nq.length - 1) {
      const prefix = nt.slice(0, nq.length);
      const dist = levenshtein(nq, prefix);
      if (dist > 0 && dist <= 2) best = Math.max(best, 780 - dist * 50);
      const distFull = levenshtein(nq, nt.slice(0, Math.min(nt.length, nq.length + 2)));
      if (distFull > 0 && distFull <= 2) best = Math.max(best, 760 - distFull * 50);
    }

    // Token match: every query token fuzzy-matches some title token
    const qTokens = q.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    const tTokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
    if (qTokens.length) {
      let tokenHits = 0;
      for (const qt of qTokens) {
        const nqt = normalizeTitle(qt);
        const hit = tTokens.some((tt) => {
          const ntt = normalizeTitle(tt);
          if (ntt.startsWith(nqt) || nqt.startsWith(ntt)) return true;
          const maxLen = Math.max(nqt.length, ntt.length);
          const dist = levenshtein(nqt, ntt);
          return maxLen >= 5 ? dist <= 2 : dist <= 1;
        });
        if (hit) tokenHits += 1;
      }
      if (tokenHits === qTokens.length) best = Math.max(best, 600 + tokenHits * 20);
      else if (tokenHits > 0) best = Math.max(best, 200 + tokenHits * 30);
    }

    // Subsequence (s-p-i-d-e-r… inside title)
    let qi = 0;
    for (const ch of nt) {
      if (ch === nq[qi]) qi += 1;
      if (qi === nq.length) {
        best = Math.max(best, 350);
        break;
      }
    }
  }

  return best;
}

export function rankMovies(query, movies, limit = 10) {
  const scored = movies
    .map((m) => ({
      movie: m,
      score: scoreMovieMatch(query, m.title, m.original_title || m.originalTitle),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (b.movie.popularity || 0) - (a.movie.popularity || 0));

  return scored.slice(0, limit).map((row) => row.movie);
}
