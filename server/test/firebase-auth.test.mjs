import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  clearFirebaseKeyCacheForTests,
  extractSubjectPublicKeyInfo,
  verifyFirebaseIdToken,
} from "../src/firebase-auth.js";
import { FIXED_NOW, makeFirebaseToken, PROJECT_ID } from "./helpers.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function derElement(tag, content) {
  let length;
  if (content.length < 128) {
    length = Buffer.from([content.length]);
  } else {
    const bytes = [];
    for (let remaining = content.length; remaining > 0; remaining = Math.floor(remaining / 256)) {
      bytes.unshift(remaining & 0xff);
    }
    length = Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, content]);
}

function certificateFor(publicKey) {
  const sequence = (...children) => derElement(0x30, Buffer.concat(children));
  const spki = publicKey.export({ type: "spki", format: "der" });
  const certificate = sequence(
    sequence(
      derElement(0x02, Buffer.from([1])),
      sequence(),
      sequence(),
      sequence(),
      sequence(),
      spki,
    ),
    sequence(),
    derElement(0x03, Buffer.from([0])),
  );
  return `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64")}\n-----END CERTIFICATE-----`;
}

describe("Firebase ID token verification", () => {
  it("loads and caches Firebase public certificates and verifies signatures", async () => {
    const previousFetch = globalThis.fetch;
    clearFirebaseKeyCacheForTests();
    const { token, keyPair: generated } = makeFirebaseToken();
    let requests = 0;
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
      requests += 1;
      return new Response(JSON.stringify({ "test-key": certificateFor(generated.publicKey) }), {
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    };

    try {
      const identity = await verifyFirebaseIdToken(token, PROJECT_ID, { nowSeconds: FIXED_NOW });
      const second = makeFirebaseToken({ sub: "another-user" }, generated);
      const secondIdentity = await verifyFirebaseIdToken(second.token, PROJECT_ID, { nowSeconds: FIXED_NOW });

      assert.deepEqual(identity, { uid: "test-user", displayName: "Test User" });
      assert.deepEqual(secondIdentity, { uid: "another-user", displayName: "Test User" });
      assert.equal(requests, 1);
    } finally {
      globalThis.fetch = previousFetch;
      clearFirebaseKeyCacheForTests();
    }
  });

  it("rejects an expired token before looking up its signing key", async () => {
    const { token } = makeFirebaseToken({ exp: FIXED_NOW - 600 });
    let lookedUp = false;
    const identity = await verifyFirebaseIdToken(token, PROJECT_ID, {
      nowSeconds: FIXED_NOW,
      resolveKey: async () => {
        lookedUp = true;
        return null;
      },
    });

    assert.equal(identity, null);
    assert.equal(lookedUp, false);
  });

  it("rejects tokens issued for another Firebase project", async () => {
    const { token } = makeFirebaseToken({ aud: "another-project" });
    const identity = await verifyFirebaseIdToken(token, PROJECT_ID, {
      nowSeconds: FIXED_NOW,
      resolveKey: async () => null,
    });

    assert.equal(identity, null);
  });

  it("extracts the SubjectPublicKeyInfo sequence from a certificate", () => {
    const keyPair = makeFirebaseToken().keyPair;
    const publicKeyInfo = keyPair.publicKey.export({ type: "spki", format: "der" });
    const pem = certificateFor(keyPair.publicKey);

    assert.deepEqual(Buffer.from(extractSubjectPublicKeyInfo(pem)), publicKeyInfo);
  });
});
