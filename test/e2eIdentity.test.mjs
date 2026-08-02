// Each "browser" gets its own localStorage, exactly like a different device.
function makeBrowser() {
  const store = new Map();
  return { getItem:k=>store.get(k)??null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };
}
const ROOT='../src/lib/e2eCrypto.js';
globalThis.localStorage = makeBrowser();
const C = await import(ROOT);

const USER = 'crossdevice_probe';
const PASSWORD = 'Sup3rSecret!pass';
const USER_ID = '00000000-0000-4000-8000-00000000abcd';
let pass=0, fail=0;
const ok=(n,c,d='')=>{ c?pass++:fail++; console.log(`${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

// --- the server's view: only ever holds these ---
const server = { publicKey:null, encPrivateKey:null, keySalt:null, keyIv:null, bcryptOf:null };

// ============ BROWSER A: sign up ============
const authSecretA = await C.deriveAuthSecret(USER, PASSWORD);
server.bcryptOf = authSecretA;                       // server bcrypts this
const idA = await C.bootstrapIdentity({
  userId: USER_ID, password: PASSWORD,
  fetchBundle: async () => ({ ...server }),
  uploadKeys: async (k) => Object.assign(server, k),
});
ok('browser A creates an identity', !!idA.publicKey);
ok('server stores a sealed private key', !!server.encPrivateKey && !!server.keySalt && !!server.keyIv);
ok('server never sees the password',
   !JSON.stringify(server).includes(PASSWORD),
   'no plaintext password anywhere in the server record');
ok('verifier is not the password', authSecretA !== PASSWORD && authSecretA.length >= 40, `${authSecretA.length} chars`);

// A creates a conversation key and wraps it to its own public key
const convKey = await C.createConversationKey();
const wrapped = await C.wrapConversationKey(convKey, server.publicKey);
const { ciphertext, iv } = await C.encryptMessage(convKey, 'ticket handover at 6pm');

// ============ BROWSER B: brand new device, same account ============
globalThis.localStorage = makeBrowser();            // nothing carried over
C.clearCryptoSession();
const authSecretB = await C.deriveAuthSecret(USER, PASSWORD);
ok('same password yields the same verifier on any device', authSecretA === authSecretB);

const idB = await C.bootstrapIdentity({
  userId: USER_ID, password: PASSWORD,
  fetchBundle: async () => ({ ...server }),
  uploadKeys: async () => { throw new Error('browser B must NOT mint a new identity'); },
});
ok('browser B recovers the same identity', idB.publicKey === idA.publicKey);

const privB = C.getCachedPrivateKey();
const recovered = await C.unwrapConversationKey(wrapped, privB);
const text = await C.decryptMessage(recovered, ciphertext, iv);
ok('browser B decrypts a message sealed on browser A', text === 'ticket handover at 6pm', `"${text}"`);

// ============ BROWSER C: wrong password must fail ============
globalThis.localStorage = makeBrowser();
C.clearCryptoSession();
let denied=false;
try {
  await C.bootstrapIdentity({ userId: USER_ID, password: 'WrongPassword!1',
    fetchBundle: async () => ({ ...server }), uploadKeys: async () => {} });
} catch { denied = true; }
ok('wrong password cannot open the sealed key', denied);

// ============ no password at all -> locked, not silent re-key ============
globalThis.localStorage = makeBrowser();
C.clearCryptoSession();
let locked=false;
try {
  await C.bootstrapIdentity({ userId: USER_ID,
    fetchBundle: async () => ({ ...server }),
    uploadKeys: async () => { throw new Error('must not overwrite the account key'); } });
} catch (e) { locked = e.code === 'LOCKED'; }
ok('no password -> LOCKED, never silently rotates the account key', locked);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
