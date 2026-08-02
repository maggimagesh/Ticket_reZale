/**
 * Client-side E2E crypto for buyer↔seller chat.
 * - Identity: ECDH P-256 keypair kept on this device (localStorage)
 * - Only the public key is uploaded to the server
 * - Per-thread AES-256-GCM conversation key, wrapped to each party via ECDH
 * - Message bodies are ciphertext only — no password unlock UI
 */

const te = new TextEncoder();
const td = new TextDecoder();

const DEVICE_KEY = 'rezale_e2e_device';

function b64(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(str) {
  if (str == null || typeof str !== 'string') {
    throw new Error('Missing base64 value');
  }
  // Normalize whitespace / URL-safe base64
  let s = str.trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  if (!/^[A-Za-z0-9+/]+=*$/.test(s)) {
    throw new Error('Invalid key encoding');
  }
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw new Error('Invalid key encoding');
  }
}

/** True if value looks like a P-256 SPKI public key (base64). */
export function isValidPublicKeyB64(value) {
  if (!value || typeof value !== 'string' || value.trim().length < 80) return false;
  try {
    const bytes = fromB64(value);
    // SPKI for P-256 is typically 91 bytes
    return bytes.length >= 80 && bytes.length <= 120;
  } catch {
    return false;
  }
}

async function importPublicKey(spkiB64) {
  if (!isValidPublicKeyB64(spkiB64)) {
    throw new Error('Peer has an invalid chat public key');
  }
  return crypto.subtle.importKey(
    'spki',
    fromB64(spkiB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
}

async function exportPublicKey(key) {
  return b64(await crypto.subtle.exportKey('spki', key));
}

async function exportPrivateJwk(key) {
  return crypto.subtle.exportKey('jwk', key);
}

async function importPrivateJwk(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

async function deriveEcdhAesKey(privateKey, publicKey, info) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdfBase = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: te.encode(info),
    },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

/** Generate a fresh identity keypair. */
export async function generateIdentityKeys() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

/** Create a random conversation AES key. */
export async function createConversationKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/**
 * Wrap conversation AES key for a recipient (ECDH ephemeral → AES-GCM).
 * Returns JSON-serializable payload stored on the thread row.
 */
export async function wrapConversationKey(aesKey, recipientPublicSpkiB64) {
  const recipientPub = await importPublicKey(recipientPublicSpkiB64);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const wrapKey = await deriveEcdhAesKey(eph.privateKey, recipientPub, 'rezale-thread-wrap-v1');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await crypto.subtle.exportKey('raw', aesKey);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, raw);
  return {
    wrapped: b64(wrapped),
    iv: b64(iv),
    ephPub: b64(await crypto.subtle.exportKey('spki', eph.publicKey)),
  };
}

/** Unwrap conversation key using our identity private key. */
export async function unwrapConversationKey(payload, myPrivateKey) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const ephPub = await importPublicKey(data.ephPub);
  const wrapKey = await deriveEcdhAesKey(myPrivateKey, ephPub, 'rezale-thread-wrap-v1');
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(data.iv) },
    wrapKey,
    fromB64(data.wrapped),
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptMessage(aesKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, te.encode(plaintext));
  return { ciphertext: b64(ciphertext), iv: b64(iv) };
}

export async function decryptMessage(aesKey, ciphertextB64, ivB64) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) },
    aesKey,
    fromB64(ciphertextB64),
  );
  return td.decode(plain);
}

/* ---------------- password-derived key material ----------------
   Two independent values come from the password, with different salts and
   domain-separation labels:

     authSecret — sent to the server in place of the password. The server
                  bcrypts it, so it never sees the password itself.
     kek        — encrypts the identity private key. Never leaves the browser.

   Because the server only ever holds authSecret, it cannot derive kek and
   therefore cannot decrypt a user's chats. The cost is that password strength
   can only be enforced client-side. */

const AUTH_ITERATIONS = 200_000;
const KEK_ITERATIONS = 250_000;

async function pbkdf2(password, salt, iterations, bits) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    bits,
  );
}

/** Verifier sent to /api/auth/* instead of the password. */
export async function deriveAuthSecret(username, password) {
  const salt = te.encode(`rezale-auth|${String(username).trim().toLowerCase()}`);
  const bits = await pbkdf2(password, salt, AUTH_ITERATIONS, 256);
  return b64(bits).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deriveKek(password, saltB64) {
  const bits = await pbkdf2(password, fromB64(saltB64), KEK_ITERATIONS, 256);
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt the identity private key so it can be stored server-side. */
export async function sealPrivateKey(privateKey, password) {
  const keySalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKek(password, keySalt);
  const jwk = te.encode(JSON.stringify(await exportPrivateJwk(privateKey)));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, jwk);
  return { encPrivateKey: b64(sealed), keySalt, keyIv: b64(iv) };
}

/** Recover the identity private key from the server-held bundle. */
export async function openPrivateKey({ encPrivateKey, keySalt, keyIv }, password) {
  const kek = await deriveKek(password, keySalt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(keyIv) },
    kek,
    fromB64(encPrivateKey),
  );
  return importPrivateJwk(JSON.parse(td.decode(plain)));
}

/* -------- identity cache for this browser -------- */

const mem = { userId: null, privateKey: null, publicKeyB64: null };
const convCache = new Map();

function readDeviceStore() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeDeviceStore(store) {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(store));
}

async function loadDeviceKeys(userId) {
  const store = readDeviceStore();
  const entry = store[userId];
  if (!entry?.jwk || !entry?.publicKeyB64) return null;
  return {
    privateKey: await importPrivateJwk(entry.jwk),
    publicKeyB64: entry.publicKeyB64,
  };
}

async function saveDeviceKeys(userId, privateKey, publicKeyB64) {
  const jwk = await exportPrivateJwk(privateKey);
  const store = readDeviceStore();
  store[userId] = { publicKeyB64, jwk };
  writeDeviceStore(store);
}

export function clearCryptoSession() {
  mem.userId = null;
  mem.privateKey = null;
  mem.publicKeyB64 = null;
  convCache.clear();
}

export function getCachedPrivateKey() {
  return mem.privateKey;
}

export function getCachedPublicKey() {
  return mem.publicKeyB64;
}

export function cacheConversationKey(threadId, key) {
  convCache.set(threadId, key);
}

export function getCachedConversationKey(threadId) {
  return convCache.get(threadId) || null;
}

/**
 * Make the account's identity key available in this browser.
 *
 * The keypair belongs to the account, not the device: the private half is
 * stored server-side sealed with a password-derived key, so signing in on any
 * browser recovers the same identity and every existing thread decrypts.
 *
 * `password` is only available at sign-in. On a later page load the key is
 * read from this browser's cache instead; if neither is available the caller
 * gets a LOCKED error and should ask the user to sign in again.
 */
export class IdentityLockedError extends Error {
  constructor() {
    super('Chat identity is locked on this browser — sign in again to unlock.');
    this.name = 'IdentityLockedError';
    this.code = 'LOCKED';
  }
}

export async function bootstrapIdentity({ userId, password, fetchBundle, uploadKeys }) {
  if (mem.userId === userId && mem.privateKey) {
    return { publicKey: mem.publicKeyB64 };
  }

  // Already unlocked in this browser
  const local = await loadDeviceKeys(userId);
  if (local) {
    mem.userId = userId;
    mem.privateKey = local.privateKey;
    mem.publicKeyB64 = local.publicKeyB64;
    return { publicKey: local.publicKeyB64 };
  }

  if (!password) throw new IdentityLockedError();

  const bundle = await fetchBundle();
  let privateKey;
  let publicKeyB64;

  if (bundle?.encPrivateKey && bundle?.keySalt && bundle?.keyIv) {
    privateKey = await openPrivateKey(bundle, password);
    publicKeyB64 = bundle.publicKey;
  } else {
    // First sign-in since escrow existed: mint the account identity once.
    const pair = await generateIdentityKeys();
    privateKey = pair.privateKey;
    publicKeyB64 = await exportPublicKey(pair.publicKey);
    const sealed = await sealPrivateKey(privateKey, password);
    await uploadKeys({ publicKey: publicKeyB64, ...sealed });
  }

  await saveDeviceKeys(userId, privateKey, publicKeyB64);
  mem.userId = userId;
  mem.privateKey = privateKey;
  mem.publicKeyB64 = publicKeyB64;
  return { publicKey: publicKeyB64 };
}
