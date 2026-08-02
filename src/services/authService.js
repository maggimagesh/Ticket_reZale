/* =====================================================================
 * services/authService.js — real auth against /api/auth/*
 * ---------------------------------------------------------------------
 * Talks to Vercel serverless routes that persist users in Supabase.
 * Session token is returned by signup/login; App.jsx persists it when
 * "Remember me" is checked.
 * ===================================================================== */

const API_BASE = '/api/auth';

export const PASSWORD_RULES = [
  { id: 'len', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'num', label: 'One number', test: (v) => /[0-9]/.test(v) },
  { id: 'sym', label: 'One symbol (!@#$…)', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function scorePassword(v) {
  return PASSWORD_RULES.reduce((n, r) => n + (r.test(v) ? 1 : 0), 0);
}

async function parseResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.reason || 'Request failed');
  }
  return data;
}

/** GET /api/auth/username-available?u= — debounce this on the caller side. */
export async function checkUsername(username) {
  const u = username.trim().toLowerCase();
  if (u.length < 3) return { ok: false, reason: 'Must be at least 3 characters' };
  if (!/^[a-z0-9._]+$/.test(u)) {
    return { ok: false, reason: 'Letters, numbers, dots and underscores only' };
  }

  const res = await fetch(`${API_BASE}/username-available?u=${encodeURIComponent(u)}`);
  return parseResponse(res);
}

/** POST /api/auth/signup */
export async function signup({ username, password, remember }) {
  const res = await fetch(`${API_BASE}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, remember }),
  });
  return parseResponse(res);
}

/** POST /api/auth/login */
export async function login({ username, password, remember }) {
  if (!username.trim() || !password) throw new Error('Enter your username and password');

  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, remember }),
  });
  return parseResponse(res);
}

/** POST /api/auth/logout */
export async function logout() {
  try {
    await fetch(`${API_BASE}/logout`, { method: 'POST' });
  } catch {
    /* client clears session either way */
  }
  return { ok: true };
}

const SESSION_KEY = 'rezale_session';

export function saveSession(session, remember) {
  const payload = JSON.stringify({
    username: session.username,
    userId: session.userId || null,
    token: session.token,
    remember: !!remember,
  });
  if (remember) {
    localStorage.setItem(SESSION_KEY, payload);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, payload);
    localStorage.removeItem(SESSION_KEY);
  }
}

export function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data?.username || !data?.token) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

/** Authorization header for authenticated API calls. */
export function authHeaders() {
  const session = loadSession();
  if (!session?.token) return {};
  return { Authorization: `Bearer ${session.token}` };
}
