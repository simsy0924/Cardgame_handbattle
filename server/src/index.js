import { AuthVerificationUnavailable, verifyFirebaseIdToken } from "./firebase-auth.js";

const ROOM_CODE_LENGTH = 4;
const ROOM_ATTEMPTS = 12;
const MAX_JSON_BODY_BYTES = 4_096;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanDisplayName(value, fallback = "Player") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 24);
  return cleaned || fallback;
}

function newRoomCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 10_000).padStart(ROOM_CODE_LENGTH, "0");
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(value);
  return match?.[1] ?? null;
}

async function readJsonObject(request) {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) throw new Error("Request too large");
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Request too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected JSON object");
  return body;
}

function internalRequest(path, principal, body, method = "POST", seatToken = null) {
  const headers = new Headers({
    "X-HandBattle-Uid": principal.uid,
    "X-HandBattle-Name": cleanDisplayName(principal.displayName),
  });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (seatToken) headers.set("X-Seat-Token", seatToken);
  return new Request(`https://room.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function internalWebSocketRequest(sourceRequest, principal, seatToken) {
  const headers = new Headers(sourceRequest.headers);
  headers.delete("Authorization");
  headers.set("X-HandBattle-Uid", principal.uid);
  headers.set("X-HandBattle-Name", cleanDisplayName(principal.displayName));
  headers.set("X-HandBattle-Operation", "stream");
  if (seatToken) headers.set("X-Seat-Token", seatToken);
  return new Request(sourceRequest, { headers });
}

async function forwardRoom(env, code, request) {
  const id = env.ROOMS.idFromName(code);
  return env.ROOMS.get(id).fetch(request);
}

export function createWorker(options = {}) {
  const authenticate = options.verifyToken ?? verifyFirebaseIdToken;

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }

      const createRoomRequest = request.method === "POST" && url.pathname === "/v1/rooms";
      const roomMatch = /^\/v1\/rooms\/(\d{4})(?:\/(join|reconnect|state|ready|stream))?$/.exec(url.pathname);
      if (!createRoomRequest && !roomMatch) return jsonResponse({ error: "not_found" }, 404);

      const token = bearerToken(request);
      if (!token) return jsonResponse({ error: "unauthorized" }, 401);

      let principal;
      try {
        principal = await authenticate(token, env.FIREBASE_PROJECT_ID);
      } catch (error) {
        if (error instanceof AuthVerificationUnavailable) {
          return jsonResponse({ error: "auth_verification_unavailable" }, 503);
        }
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      if (!principal) return jsonResponse({ error: "unauthorized" }, 401);

      let body = {};
      if (request.method !== "GET") {
        try {
          body = await readJsonObject(request);
        } catch {
          return jsonResponse({ error: "invalid_request" }, 400);
        }
      }

      if (createRoomRequest) {
        for (let attempt = 0; attempt < ROOM_ATTEMPTS; attempt += 1) {
          const code = newRoomCode();
          const response = await forwardRoom(
            env,
            code,
            internalRequest("/_internal/create", principal, {
              roomCode: code,
              displayName: cleanDisplayName(body.displayName, principal.displayName),
            }),
          );
          if (response.status !== 409) {
            const result = await response.json();
            return jsonResponse({ roomCode: code, ...result }, response.status);
          }
        }
        return jsonResponse({ error: "room_code_unavailable" }, 503);
      }

      const [, code, action] = roomMatch;
      const seatToken = request.headers.get("X-Seat-Token");
      switch (action) {
        case "join":
          if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
          return forwardRoom(env, code, internalRequest("/_internal/join", principal, {
            displayName: cleanDisplayName(body.displayName, principal.displayName),
          }));
        case "reconnect":
          if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
          return forwardRoom(env, code, internalRequest("/_internal/reconnect", principal, {}, "POST", seatToken));
        case "state":
          if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);
          return forwardRoom(env, code, internalRequest("/_internal/state", principal, undefined, "GET", seatToken));
        case "ready":
          if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
          if (typeof body.ready !== "boolean") return jsonResponse({ error: "invalid_request" }, 400);
          return forwardRoom(env, code, internalRequest("/_internal/ready", principal, { ready: body.ready }, "POST", seatToken));
        case "stream":
          if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);
          if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return jsonResponse({ error: "websocket_required" }, 426);
          }
          return forwardRoom(env, code, internalWebSocketRequest(request, principal, seatToken));
        default:
          if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);
          return forwardRoom(env, code, internalRequest("/_internal/state", principal, undefined, "GET", seatToken));
      }
    },
  };
}

export default createWorker();
