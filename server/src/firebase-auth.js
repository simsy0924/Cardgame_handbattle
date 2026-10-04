const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LENGTH = 8_192;

let cachedCertificates = null;
let certificatesExpireAt = 0;
let certificatesRequest = null;
let lastUnknownKeyRefreshAt = 0;
const importedKeys = new Map();

export class AuthVerificationUnavailable extends Error {
  constructor() {
    super("Firebase public keys could not be loaded");
    this.name = "AuthVerificationUnavailable";
  }
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Malformed token");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function readDerElement(bytes, offset) {
  if (offset >= bytes.length) throw new Error("Malformed certificate");
  const tag = bytes[offset];
  const start = offset;
  let cursor = offset + 1;
  if (cursor >= bytes.length) throw new Error("Malformed certificate");

  let length = bytes[cursor++];
  if ((length & 0x80) !== 0) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || cursor + count > bytes.length) {
      throw new Error("Malformed certificate");
    }
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = length * 256 + bytes[cursor++];
    }
  }

  const contentStart = cursor;
  const end = contentStart + length;
  if (end > bytes.length) throw new Error("Malformed certificate");
  return { tag, start, contentStart, end, next: end };
}

function childElements(bytes, sequence) {
  const children = [];
  for (let cursor = sequence.contentStart; cursor < sequence.end;) {
    const child = readDerElement(bytes, cursor);
    if (child.next <= cursor || child.next > sequence.end) throw new Error("Malformed certificate");
    children.push(child);
    cursor = child.next;
  }
  return children;
}

export function extractSubjectPublicKeyInfo(certificatePem) {
  const body = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");
  const derText = atob(body);
  const der = Uint8Array.from(derText, (character) => character.charCodeAt(0));
  const certificate = readDerElement(der, 0);
  if (certificate.tag !== 0x30 || certificate.next !== der.length) throw new Error("Malformed certificate");

  const certificateFields = childElements(der, certificate);
  const tbs = certificateFields[0];
  if (!tbs || tbs.tag !== 0x30) throw new Error("Malformed certificate");

  const tbsFields = childElements(der, tbs);
  let index = tbsFields[0]?.tag === 0xa0 ? 1 : 0;
  // version (optional), serial, signature, issuer, validity, subject, subjectPublicKeyInfo
  const subjectPublicKeyInfo = tbsFields[index + 5];
  if (!subjectPublicKeyInfo || subjectPublicKeyInfo.tag !== 0x30) {
    throw new Error("Malformed certificate");
  }
  return der.slice(subjectPublicKeyInfo.start, subjectPublicKeyInfo.end);
}

async function loadCertificates(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedCertificates && now < certificatesExpireAt) return cachedCertificates;
  if (certificatesRequest) return certificatesRequest;

  certificatesRequest = (async () => {
    try {
      const response = await fetch(FIREBASE_CERTS_URL);
      if (!response.ok) throw new Error("Certificate request failed");
      const certificates = await response.json();
      if (!certificates || typeof certificates !== "object" || Array.isArray(certificates)) {
        throw new Error("Malformed certificate response");
      }
      const maxAge = response.headers.get("cache-control")?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1];
      const lifetimeSeconds = maxAge ? Number(maxAge) : 300;
      cachedCertificates = certificates;
      certificatesExpireAt = Date.now() + Math.max(0, Math.min(lifetimeSeconds, 21_600)) * 1_000;
      importedKeys.clear();
      return cachedCertificates;
    } catch {
      if (cachedCertificates && Date.now() < certificatesExpireAt) return cachedCertificates;
      throw new AuthVerificationUnavailable();
    } finally {
      certificatesRequest = null;
    }
  })();

  return certificatesRequest;
}

async function getSigningKey(keyId) {
  if (importedKeys.has(keyId)) return importedKeys.get(keyId);

  let certificates = await loadCertificates();
  if (!Object.hasOwn(certificates, keyId)) {
    // A recently rotated Google signing key can appear before this isolate's cache expires.
    // Limit forced refreshes so arbitrary kid values cannot cause a certificate fetch per request.
    if (Date.now() - lastUnknownKeyRefreshAt >= 30_000) {
      lastUnknownKeyRefreshAt = Date.now();
      certificates = await loadCertificates(true);
    }
  }

  const pem = certificates[keyId];
  if (typeof pem !== "string") return null;

  try {
    const spki = extractSubjectPublicKeyInfo(pem);
    const key = await crypto.subtle.importKey(
      "spki",
      spki,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    importedKeys.set(keyId, key);
    return key;
  } catch {
    return null;
  }
}

function validClaims(claims, projectId, nowSeconds) {
  if (!claims || typeof claims !== "object") return false;
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return false;
  if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 128) return false;
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) return false;
  if (!Number.isFinite(claims.iat) || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) return false;
  if (!Number.isFinite(claims.auth_time) || claims.auth_time > nowSeconds + CLOCK_SKEW_SECONDS) return false;
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS)) return false;
  return true;
}

export async function verifyFirebaseIdToken(token, projectId, options = {}) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  if (typeof projectId !== "string" || projectId.length === 0) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header;
  let claims;
  try {
    header = decodeJsonPart(parts[0]);
    claims = decodeJsonPart(parts[1]);
  } catch {
    return null;
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 128) return null;
  if (!validClaims(claims, projectId, nowSeconds)) return null;

  const resolveKey = options.resolveKey ?? getSigningKey;
  const key = await resolveKey(header.kid);
  if (!key) return null;

  let signature;
  try {
    signature = decodeBase64Url(parts[2]);
  } catch {
    return null;
  }

  let validSignature = false;
  try {
    validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return null;
  }

  if (!validSignature) return null;
  return {
    uid: claims.sub,
    displayName: typeof claims.name === "string" ? claims.name.slice(0, 80) : "",
  };
}

export function clearFirebaseKeyCacheForTests() {
  cachedCertificates = null;
  certificatesExpireAt = 0;
  certificatesRequest = null;
  lastUnknownKeyRefreshAt = 0;
  importedKeys.clear();
}
