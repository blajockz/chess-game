const INFO = new TextEncoder().encode("tempo-admin-v1");

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const unb64 = (text: string) => {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export type KeyPair = { pair: CryptoKeyPair; publicB64: string };

export async function newKeyPair(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return { pair, publicB64: b64(raw) };
}

export async function sharedKey(mine: KeyPair, serverPublicB64: string, sessionId: string): Promise<CryptoKey> {
  const theirs = await crypto.subtle.importKey("raw", unb64(serverPublicB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, mine.pair.privateKey, 256);
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(sessionId), info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function seal(key: CryptoKey, aad: string, data: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(JSON.stringify(data))
  );
  return { iv: b64(iv), ct: b64(ct) };
}

export async function open(key: CryptoKey, aad: string, iv: string, ct: string): Promise<unknown> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(aad) },
    key,
    unb64(ct)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}