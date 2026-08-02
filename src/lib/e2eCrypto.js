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

/* -------- device-local identity (no password unlock) -------- */

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
 * Ensure identity keys exist on this device and public key is on the server.
 * No password — keys live in localStorage for this browser.
 */
export async function bootstrapIdentity({ userId, fetchPublicKey, uploadPublicKey }) {
  if (mem.userId === userId && mem.privateKey) {
    return { publicKey: mem.publicKeyB64 };
  }

  let privateKey;
  let publicKeyB64;
  const local = await loadDeviceKeys(userId);

  if (local) {
    privateKey = local.privateKey;
    publicKeyB64 = local.publicKeyB64;
  } else {
    const pair = await generateIdentityKeys();
    privateKey = pair.privateKey;
    publicKeyB64 = await exportPublicKey(pair.publicKey);
    await saveDeviceKeys(userId, privateKey, publicKeyB64);
  }

  const remote = await fetchPublicKey();
  if (remote?.publicKey !== publicKeyB64) {
    await uploadPublicKey(publicKeyB64);
  }

  mem.userId = userId;
  mem.privateKey = privateKey;
  mem.publicKeyB64 = publicKeyB64;
  return { publicKey: publicKeyB64 };
}
