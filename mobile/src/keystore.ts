// Device identity: a non-extractable Ed25519 keypair plus the enrolled
// deviceId, both persisted in IndexedDB (CryptoKey objects survive structured
// clone; the private key never leaves the WebCrypto boundary).

const DB_NAME = 'proxies';
const STORE = 'identity';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export async function ensureKeyPair(): Promise<CryptoKeyPair> {
  const existing = await idbGet<CryptoKeyPair>('keyPair');
  if (existing) {
    return existing;
  }
  const pair = (await crypto.subtle.generateKey('Ed25519', false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  await idbSet('keyPair', pair);
  return pair;
}

export async function exportPublicKeyB64(pair: CryptoKeyPair): Promise<string> {
  return toBase64(await crypto.subtle.exportKey('raw', pair.publicKey));
}

export async function signMessage(message: string): Promise<string> {
  const pair = await ensureKeyPair();
  const signature = await crypto.subtle.sign(
    'Ed25519',
    pair.privateKey,
    new TextEncoder().encode(message)
  );
  return toBase64(signature);
}

export async function getDeviceId(): Promise<string | null> {
  return (await idbGet<string>('deviceId')) ?? null;
}

export async function setDeviceId(deviceId: string): Promise<void> {
  await idbSet('deviceId', deviceId);
}
