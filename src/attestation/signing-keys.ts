/**
 * Persists the developer's client-side attestation signing keypair.
 *
 * CryptoKey objects are structured-cloneable, so they can be stored in
 * IndexedDB directly — no export/import round-trip needed for the private
 * key, which we generate non-extractable so it can never leave this
 * browser profile even in memory-dump form. Trust model is TOFU: the first
 * generated public key is registered against the developer's Firestore
 * profile (see src/firebase/rules-repository.ts) and used to verify every
 * later receipt from that developer.
 */
const DB_NAME = 'zt-wasm-mesh';
const STORE_NAME = 'signing-keys';
const RECORD_KEY = 'attestation-keypair';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('failed to open IndexedDB'));
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
  });
}

async function idbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
  });
}

const SIGNING_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

/** Returns this browser profile's ECDSA P-256 signing keypair, generating
 *  and persisting one on first call. The private key is non-extractable —
 *  crypto.subtle.sign() can use it, but it can never be serialized out. */
export async function getOrCreateSigningKeyPair(): Promise<CryptoKeyPair> {
  const cached = await idbGet<CryptoKeyPair>(STORE_NAME, RECORD_KEY);
  if (cached?.privateKey && cached?.publicKey) return cached;

  const keyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, false, ['sign', 'verify']);
  await idbPut(STORE_NAME, RECORD_KEY, keyPair);
  return keyPair;
}

export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', publicKey);
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, SIGNING_ALGORITHM, true, ['verify']);
}
