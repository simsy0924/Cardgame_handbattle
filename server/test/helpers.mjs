import { createSign, generateKeyPairSync, webcrypto } from "node:crypto";
import { Room } from "../src/room.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

export const PROJECT_ID = "cardgame-1b151";
export const FIXED_NOW = 1_800_000_000;

export function makeFirebaseToken(overrides = {}, keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 })) {
  const header = { alg: "RS256", kid: "test-key", typ: "JWT" };
  const claims = {
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: "test-user",
    iat: FIXED_NOW - 60,
    auth_time: FIXED_NOW - 120,
    exp: FIXED_NOW + 3_000,
    name: "Test User",
    ...overrides,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return {
    token: `${unsigned}.${signer.sign(keyPair.privateKey).toString("base64url")}`,
    keyPair,
  };
}

export class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
  }

  async get(key) {
    return this.values.get(key);
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }

  async delete(key) {
    return this.values.delete(key);
  }

  async setAlarm(time) {
    this.alarmAt = time;
  }
}

export class MemoryDurableObjectNamespace {
  constructor() {
    this.rooms = new Map();
  }

  idFromName(name) {
    return { name };
  }

  get(id) {
    if (!this.rooms.has(id.name)) {
      const ctx = {
        id,
        storage: new MemoryStorage(),
        getWebSockets: () => [],
        acceptWebSocket: () => {},
      };
      this.rooms.set(id.name, new Room(ctx, {}));
    }
    return this.rooms.get(id.name);
  }
}

export function apiRequest(path, { method = "GET", token = "ok", seatToken, body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  if (seatToken) requestHeaders.set("X-Seat-Token", seatToken);
  if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
  return new Request(`https://worker.test${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
