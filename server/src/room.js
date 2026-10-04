const ROOM_KEY = "room";
const ROOM_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_SOCKET_MESSAGE_LENGTH = 4_096;
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

function makeSeatToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashSeatToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function principalFrom(request) {
  const uid = request.headers.get("X-HandBattle-Uid");
  if (!uid || uid.length > 128) return null;
  return {
    uid,
    displayName: cleanDisplayName(request.headers.get("X-HandBattle-Name")),
  };
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

function readyPhase(players) {
  return players[0]?.ready && players[1]?.ready ? "ready" : "waiting";
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.operationTail = Promise.resolve();
  }

  async serialized(operation) {
    const previous = this.operationTail;
    let release;
    this.operationTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("X-HandBattle-Operation") === "stream") return this.openStream(request);
    if (!url.pathname.startsWith("/_internal/")) return jsonResponse({ error: "not_found" }, 404);

    switch (`${request.method} ${url.pathname}`) {
      case "POST /_internal/create":
        return this.createRoom(request);
      case "POST /_internal/join":
        return this.joinRoom(request);
      case "POST /_internal/reconnect":
        return this.reconnect(request);
      case "GET /_internal/state":
        return this.readState(request);
      case "POST /_internal/ready":
        return this.setReady(request);
      case "POST /_internal/leave":
        return this.leaveRoom(request);
      case "GET /_internal/stream":
        return this.openStream(request);
      default:
        return jsonResponse({ error: "not_found" }, 404);
    }
  }

  async createRoom(request) {
    const principal = principalFrom(request);
    let body;
    try {
      body = await readJsonObject(request);
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    if (!principal || typeof body.roomCode !== "string" || !/^\d{4}$/.test(body.roomCode)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    return this.serialized(async () => {
      if (await this.ctx.storage.get(ROOM_KEY)) return jsonResponse({ error: "room_exists" }, 409);
      const seatToken = makeSeatToken();
      const now = Date.now();
      const room = {
        code: body.roomCode,
        phase: "waiting",
        sequence: 1,
        createdAt: now,
        lastActivityAt: now,
        players: [
          {
            uid: principal.uid,
            displayName: cleanDisplayName(body.displayName, principal.displayName),
            ready: false,
            seatTokenHash: await hashSeatToken(seatToken),
          },
          null,
        ],
      };
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.scheduleExpiry(now);
      return jsonResponse({ seat: 0, seatToken, room: this.snapshot(room, principal.uid) }, 201);
    });
  }

  async joinRoom(request) {
    const principal = principalFrom(request);
    if (!principal) return jsonResponse({ error: "unauthorized" }, 401);
    let body;
    try {
      body = await readJsonObject(request);
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    return this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return jsonResponse({ error: "room_not_found" }, 404);
      if (room.players.some((player) => player?.uid === principal.uid)) {
        return jsonResponse({ error: "use_reconnect" }, 409);
      }
      const openSeat = room.players.findIndex((player) => player === null);
      if (openSeat < 0) return jsonResponse({ error: "room_full" }, 409);

      const seatToken = makeSeatToken();
      room.players[openSeat] = {
        uid: principal.uid,
        displayName: cleanDisplayName(body.displayName, principal.displayName),
        ready: false,
        seatTokenHash: await hashSeatToken(seatToken),
      };
      room.phase = readyPhase(room.players);
      room.sequence += 1;
      room.lastActivityAt = Date.now();
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.scheduleExpiry(room.lastActivityAt);
      await this.broadcast(room);
      return jsonResponse({ seat: openSeat, seatToken, room: this.snapshot(room, principal.uid) });
    });
  }

  async reconnect(request) {
    const principal = principalFrom(request);
    if (!principal) return jsonResponse({ error: "unauthorized" }, 401);
    const token = request.headers.get("X-Seat-Token") ?? "";
    return this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return jsonResponse({ error: "room_not_found" }, 404);
      const seat = await this.findSeat(room, principal.uid, token);
      if (seat < 0) return jsonResponse({ error: "invalid_seat_token" }, 403);
      room.lastActivityAt = Date.now();
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.scheduleExpiry(room.lastActivityAt);
      return jsonResponse({ seat, room: this.snapshot(room, principal.uid) });
    });
  }

  async readState(request) {
    const principal = principalFrom(request);
    if (!principal) return jsonResponse({ error: "unauthorized" }, 401);
    const token = request.headers.get("X-Seat-Token") ?? "";
    return this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return jsonResponse({ error: "room_not_found" }, 404);
      const seat = await this.findSeat(room, principal.uid, token);
      if (seat < 0) return jsonResponse({ error: "invalid_seat_token" }, 403);
      return jsonResponse({ seat, room: this.snapshot(room, principal.uid) });
    });
  }

  async setReady(request) {
    const principal = principalFrom(request);
    const token = request.headers.get("X-Seat-Token") ?? "";
    let body;
    try {
      body = await readJsonObject(request);
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    if (!principal || typeof body.ready !== "boolean") {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    return this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return jsonResponse({ error: "room_not_found" }, 404);
      const seat = await this.findSeat(room, principal.uid, token);
      if (seat < 0) return jsonResponse({ error: "invalid_seat_token" }, 403);
      room.players[seat].ready = body.ready;
      room.phase = readyPhase(room.players);
      room.sequence += 1;
      room.lastActivityAt = Date.now();
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.scheduleExpiry(room.lastActivityAt);
      await this.broadcast(room);
      return jsonResponse({ seat, room: this.snapshot(room, principal.uid) });
    });
  }

  async leaveRoom(request) {
    const principal = principalFrom(request);
    const token = request.headers.get("X-Seat-Token") ?? "";
    if (!principal) return jsonResponse({ error: "unauthorized" }, 401);

    return this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return jsonResponse({ error: "room_not_found" }, 404);
      const seat = await this.findSeat(room, principal.uid, token);
      if (seat < 0) return jsonResponse({ error: "invalid_seat_token" }, 403);

      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment();
        if (attachment?.uid === principal.uid) socket.close(1000, "Player left the room");
      }

      room.players[seat] = null;
      room.phase = readyPhase(room.players);
      room.sequence += 1;
      room.lastActivityAt = Date.now();
      if (room.players.every((player) => player === null)) {
        await this.ctx.storage.delete(ROOM_KEY);
        return jsonResponse({ left: true });
      }

      await this.ctx.storage.put(ROOM_KEY, room);
      await this.scheduleExpiry(room.lastActivityAt);
      await this.broadcast(room);
      return jsonResponse({ left: true });
    });
  }

  async openStream(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "websocket_required" }, 426);
    }
    const principal = principalFrom(request);
    const token = request.headers.get("X-Seat-Token") ?? "";
    if (!principal) return jsonResponse({ error: "unauthorized" }, 401);

    return this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return jsonResponse({ error: "room_not_found" }, 404);
      const seat = await this.findSeat(room, principal.uid, token);
      if (seat < 0) return jsonResponse({ error: "invalid_seat_token" }, 403);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment();
        if (attachment?.uid === principal.uid) socket.close(1012, "Reconnected from another device");
      }
      server.serializeAttachment({ uid: principal.uid, seat });
      this.ctx.acceptWebSocket(server, [`seat-${seat}`]);
      server.send(JSON.stringify({ type: "snapshot", room: this.snapshot(room, principal.uid) }));
      await this.broadcast(room);
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  async webSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment();
    if (!attachment || typeof message !== "string" || message.length > MAX_SOCKET_MESSAGE_LENGTH) {
      socket.send(JSON.stringify({ type: "error", error: "invalid_message" }));
      return;
    }

    let command;
    try {
      command = JSON.parse(message);
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "invalid_message" }));
      return;
    }

    if (command.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (command.type !== "ready" || typeof command.ready !== "boolean") {
      socket.send(JSON.stringify({ type: "error", error: "unsupported_command" }));
      return;
    }

    await this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room || room.players[attachment.seat]?.uid !== attachment.uid) {
        socket.send(JSON.stringify({ type: "error", error: "seat_unavailable" }));
        return;
      }
      room.players[attachment.seat].ready = command.ready;
      room.phase = readyPhase(room.players);
      room.sequence += 1;
      room.lastActivityAt = Date.now();
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.scheduleExpiry(room.lastActivityAt);
      await this.broadcast(room);
    });
  }

  async webSocketClose() {
    await this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (room) await this.broadcast(room);
    });
  }

  async alarm() {
    return this.serialized(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return;
      const expiresAt = room.lastActivityAt + ROOM_TTL_MS;
      if (expiresAt <= Date.now()) {
        for (const socket of this.ctx.getWebSockets()) socket.close(1001, "Room expired");
        await this.ctx.storage.delete(ROOM_KEY);
        return;
      }
      await this.ctx.storage.setAlarm(expiresAt);
    });
  }

  async findSeat(room, uid, token) {
    const seat = room.players.findIndex((player) => player?.uid === uid);
    if (seat < 0 || !token) return -1;
    const actualHash = await hashSeatToken(token);
    return safeEqual(room.players[seat].seatTokenHash, actualHash) ? seat : -1;
  }

  async scheduleExpiry(lastActivityAt) {
    await this.ctx.storage.setAlarm(lastActivityAt + ROOM_TTL_MS);
  }

  snapshot(room, viewerUid) {
    const connectedSeats = new Set();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      const attachment = socket.deserializeAttachment();
      if (attachment?.uid) connectedSeats.add(attachment.seat);
    }

    return {
      code: room.code,
      phase: room.phase,
      sequence: room.sequence,
      viewerSeat: room.players.findIndex((player) => player?.uid === viewerUid),
      players: room.players.map((player, seat) => player ? {
        seat,
        displayName: player.displayName,
        ready: player.ready,
        connected: connectedSeats.has(seat),
      } : null),
      updatedAt: room.lastActivityAt,
    };
  }

  async broadcast(room) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      const attachment = socket.deserializeAttachment();
      if (!attachment?.uid) continue;
      socket.send(JSON.stringify({ type: "snapshot", room: this.snapshot(room, attachment.uid) }));
    }
  }
}
