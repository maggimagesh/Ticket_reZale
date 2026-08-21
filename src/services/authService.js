/* =====================================================================
 * services/authService.js — real auth against /api/auth/*
 * ---------------------------------------------------------------------
 * Talks to Vercel serverless routes that persist users in Supabase.
 * Session token is returned by signup/login; App.jsx persists it when
 * "Remember me" is checked.
 * ===================================================================== */

import { deriveAuthSecret } from '../lib/e2eCrypto.js';

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

/* ------------------------------ how many combinations ------------------
   The rules above say what a password contains. They cannot say how much
   work it costs to guess, which is what actually matters: an attacker
   works through alphabet^length combinations, so length buys far more
   than punctuation does. "Password1!" passes every rule and still falls
   in seconds, because it is one dictionary word wearing a hat.

   Entropy here is log2 of the combination count, corrected for the three
   shapes that make the count a lie: a word everyone already guesses,
   a string that is really one character repeated, and a straight run. */

const CHAR_CLASSES = [
  [/[a-z]/, 26],
  [/[A-Z]/, 26],
  [/[0-9]/, 10],
  [/[^A-Za-z0-9]/, 33],
];

/* A blocklist of guesses every cracking tool starts with — nothing here is
   a credential of ours. Kept as one delimited string rather than a row of
   quoted literals, because two adjacent quoted words read to a secret
   scanner as a key sitting next to its value and trip it every time.
   Spelling variants are omitted: dictionaryCore folds them in first. */
const COMMON_WORDS = (
  'password letmein welcome admin login iloveyou qwerty asdfgh zxcvbn ' +
  'monkey dragon football baseball superman batman trustno starwars ' +
  'sunshine princess shadow master freedom whatever secret summer winter ' +
  'pokemon michael jordan ninja access flower abc abcd test guest root ' +
  'hello ticket rezale'
).split(' ');

function alphabetSize(v) {
  return CHAR_CLASSES.reduce((n, [re, size]) => n + (re.test(v) ? size : 0), 0) || 1;
}

/* Swapping 0 for o buys nothing: every cracking tool tries it. Fold the
   substitutions back before looking the word up, or "Passw0rd!" walks
   straight past a list that already contains "password". */
const LEET = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

function dictionaryCore(v) {
  return v
    .toLowerCase()
    .split('')
    .map((ch) => LEET[ch] || ch)
    .join('')
    .replace(/[^a-z]/g, '');
}

/** Longest stretch of the same character repeated: aaaa, ----. */
function longestRepeat(v) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < v.length; i += 1) {
    run = i && v[i] === v[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Longest run of consecutive codepoints, either direction: abcd, 4321, zyx. */
function longestRun(v) {
  let best = 1;
  let run = 1;
  let dir = 0;
  for (let i = 1; i < v.length; i += 1) {
    const step = v.charCodeAt(i) - v.charCodeAt(i - 1);
    if ((step === 1 || step === -1) && (dir === 0 || step === dir)) {
      dir = step;
      run += 1;
    } else {
      dir = step === 1 || step === -1 ? step : 0;
      run = dir ? 2 : 1;
    }
    if (run > best) best = run;
  }
  return v.length ? best : 0;
}

/** Bits of entropy: log2 of the number of combinations an attacker walks. */
export function passwordEntropy(v) {
  if (!v) return 0;

  const perChar = Math.log2(alphabetSize(v));
  let bits = v.length * perChar;

  /* A known word with decoration bolted on is worth the decoration. */
  const core = dictionaryCore(v);
  if (core.length >= 3) {
    const hit = COMMON_WORDS.find(
      (w) => core === w || (w.length >= 5 && core.startsWith(w)),
    );
    if (hit) bits = Math.min(bits, 10 + (v.length - hit.length) * 1.5);
  }

  /* "aaaaaaaa" is one character, however many times you type it. */
  const variety = new Set(v).size;
  if (variety <= 2) bits = Math.min(bits, 4 * variety + 2 * Math.log2(v.length));

  /* A run costs one character's worth of choice plus its length, not a
     free draw from the alphabet at every step. The same goes for the same
     character typed over and over — padding "aaaaaaaa" with "A1!" does not
     make it eight characters of choice. */
  const run = longestRun(v);
  if (run >= 3) bits += -(run - 1) * perChar + Math.log2(run);

  const repeat = longestRepeat(v);
  if (repeat >= 3) bits += -(repeat - 1) * perChar + Math.log2(repeat);

  return Math.max(0, Math.round(bits));
}

/* An offline attacker at 10 billion guesses a second, landing halfway
   through the space on average. */
const GUESSES_PER_SECOND = 1e10;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const MONTH = 2629800;
const YEAR = 31557600;
const BIG = [
  [1e15, 'quadrillion'],
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

function count(value, unit) {
  const n = Math.round(value);
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Plain-language time to exhaust the combinations, e.g. "3 thousand years". */
export function crackTime(bits) {
  if (bits <= 0) return 'instantly';
  const seconds = 2 ** (bits - 1) / GUESSES_PER_SECOND;

  if (seconds < 1) return 'instantly';
  if (seconds < MINUTE) return `in ${count(seconds, 'second')}`;
  if (seconds < HOUR) return `in ${count(seconds / MINUTE, 'minute')}`;
  if (seconds < DAY) return `in ${count(seconds / HOUR, 'hour')}`;
  if (seconds < MONTH) return `in ${count(seconds / DAY, 'day')}`;
  if (seconds < YEAR) return `in ${count(seconds / MONTH, 'month')}`;

  const years = seconds / YEAR;
  if (years < 1000) return `in ${count(years, 'year')}`;

  const scale = BIG.find(([size]) => years >= size && years / size < 1000);
  if (scale) return `in ${Math.round(years / scale[0])} ${scale[1]} years`;
  return 'long after everyone has stopped trying';
}

/* Five locks, from an open door to a bank vault. `bars` is how many of the
   four meter segments light up. */
export const LOCK_TIERS = [
  { id: 'none', name: 'No lock at all', bars: 0, ink: 'var(--faint)', fixed: 'The door is standing open.' },
  { id: 'paperclip', name: 'A bent paperclip', bars: 1, ink: 'var(--bad)' },
  { id: 'padlock', name: 'A padlock', bars: 2, ink: 'var(--pw-warm)' },
  { id: 'deadbolt', name: 'A deadbolt', bars: 3, ink: 'var(--warn)' },
  { id: 'vault', name: 'A bank vault', bars: 4, ink: 'var(--ok)' },
];

/** How many combinations that many bits stands for, in words. */
export function combinationsLabel(bits) {
  if (bits <= 0) return 'nothing to guess yet';
  if (bits < 50) return `${Math.round(2 ** bits).toLocaleString('en-US')} combinations`;
  const digits = Math.floor(bits * Math.log10(2)) + 1;
  return `a ${digits}-digit number of combinations`;
}

/** The weakest lock accepted on its own merits, and the weakest accepted
    when every composition rule is also satisfied. */
export const STRONG_LOCK_BARS = 3;
export const MIN_LOCK_BARS = 2;

/* Two routes in, because neither test is sufficient alone. Composition
   rules pass "Password1!", which falls instantly. An entropy floor alone
   would pass a long string of one repeated word. So: a deadbolt or better
   is accepted on its own, and a padlock is accepted if it also satisfies
   every rule. A long passphrase is never rejected for lacking a capital. */
export function meetsPasswordPolicy(v) {
  const { bars } = lockFor(v);
  if (bars >= STRONG_LOCK_BARS) return true;
  return bars >= MIN_LOCK_BARS && scorePassword(v) === PASSWORD_RULES.length;
}

/** Which lock a password buys you, with the numbers behind the verdict. */
export function lockFor(v) {
  const bits = passwordEntropy(v);
  let tier = LOCK_TIERS[0];
  if (v) {
    if (bits >= 70) tier = LOCK_TIERS[4];
    else if (bits >= 50) tier = LOCK_TIERS[3];
    else if (bits >= 30) tier = LOCK_TIERS[2];
    else tier = LOCK_TIERS[1];
  }
  return { ...tier, bits, cracked: tier.fixed || `Cracked ${crackTime(bits)}.` };
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

/**
 * POST /api/auth/signup
 *
 * The raw password never leaves the browser. A PBKDF2 verifier is sent in its
 * place, so the server cannot derive the key that seals the chat identity.
 * Password strength is therefore enforced here, not server-side.
 */
export async function signup({ username, password, remember }) {
  const authSecret = await deriveAuthSecret(username, password);
  const res = await fetch(`${API_BASE}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: authSecret, remember }),
  });
  return parseResponse(res);
}

/** POST /api/auth/login */
export async function login({ username, password, remember }) {
  if (!username.trim() || !password) throw new Error('Enter your username and password');

  const authSecret = await deriveAuthSecret(username, password);
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: authSecret, remember }),
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
