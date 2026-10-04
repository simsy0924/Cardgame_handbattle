import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../src/index.js";
import { apiRequest, MemoryDurableObjectNamespace } from "./helpers.mjs";

const verifyToken = async (token) => token === "ok" ? { uid: "player-one", displayName: "One" } :
  token === "second" ? { uid: "player-two", displayName: "Two" } :
  token === "third" ? { uid: "player-three", displayName: "Three" } : null;

function setup() {
  const rooms = new MemoryDurableObjectNamespace();
  const worker = createWorker({ verifyToken });
  const env = { ROOMS: rooms, FIREBASE_PROJECT_ID: "test-project" };
  return { rooms, worker, env };
}

async function json(response) {
  return response.json();
}

describe("online room API", () => {
  it("creates a four-digit private room and never returns server token hashes", async () => {
    const { worker, env } = setup();
    const response = await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: { displayName: "Host" },
    }), env);
    const result = await json(response);

    assert.equal(response.status, 201);
    assert.match(result.roomCode, /^\d{4}$/);
    assert.equal(result.seat, 0);
    assert.equal(typeof result.seatToken, "string");
    assert.equal(result.seatToken.length, 43);
    assert.equal(result.room.players[0].displayName, "Host");
    assert.equal(JSON.stringify(result).includes("seatTokenHash"), false);
    assert.equal(JSON.stringify(result).includes("player-one"), false);
  });

  it("allows two seats, rejects a third player, and keeps leading zeroes", async () => {
    const { worker, env } = setup();
    const create = await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: { displayName: "Host" },
    }), env);
    const created = await json(create);
    const code = created.roomCode;

    const join = await worker.fetch(apiRequest(`/v1/rooms/${code}/join`, {
      method: "POST",
      token: "second",
      body: { displayName: "Guest" },
    }), env);
    const joined = await json(join);

    assert.equal(join.status, 200);
    assert.equal(joined.seat, 1);
    assert.equal(joined.room.code, code);
    assert.equal(joined.room.players[1].displayName, "Guest");

    const third = await worker.fetch(apiRequest(`/v1/rooms/${code}/join`, {
      method: "POST",
      token: "third",
      body: {},
    }), env);
    assert.equal(third.status, 409);
  });

  it("serializes simultaneous join attempts so only one takes the open seat", async () => {
    const { worker, env } = setup();
    const created = await json(await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: {},
    }), env));
    const path = `/v1/rooms/${created.roomCode}/join`;

    const responses = await Promise.all([
      worker.fetch(apiRequest(path, { method: "POST", token: "second", body: {} }), env),
      worker.fetch(apiRequest(path, { method: "POST", token: "third", body: {} }), env),
    ]);

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  });

  it("requires the seat token for reconnect, state, and ready changes", async () => {
    const { worker, env } = setup();
    const created = await json(await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: {},
    }), env));
    const path = `/v1/rooms/${created.roomCode}`;

    const wrongToken = await worker.fetch(apiRequest(`${path}/state`, {
      seatToken: "wrong-seat-token",
    }), env);
    assert.equal(wrongToken.status, 403);

    const reconnect = await worker.fetch(apiRequest(`${path}/reconnect`, {
      method: "POST",
      seatToken: created.seatToken,
      body: {},
    }), env);
    assert.equal(reconnect.status, 200);
    assert.equal((await json(reconnect)).seat, 0);

    const ready = await worker.fetch(apiRequest(`${path}/ready`, {
      method: "POST",
      seatToken: created.seatToken,
      body: { ready: true },
    }), env);
    const readyResult = await json(ready);
    assert.equal(ready.status, 200);
    assert.equal(readyResult.room.players[0].ready, true);
    assert.equal(readyResult.room.phase, "waiting");
  });

  it("checks both Firebase identity and seat token before accepting a WebSocket room stream", async () => {
    const { worker, env } = setup();
    const created = await json(await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: {},
    }), env));
    const path = `/v1/rooms/${created.roomCode}/stream`;

    const noUpgrade = await worker.fetch(apiRequest(path, { seatToken: created.seatToken }), env);
    const wrongSeat = await worker.fetch(apiRequest(path, {
      seatToken: "wrong-token",
      headers: { Upgrade: "websocket" },
    }), env);

    assert.equal(noUpgrade.status, 426);
    assert.equal(wrongSeat.status, 403);
  });

  it("marks a room ready only after both participants confirm", async () => {
    const { worker, env } = setup();
    const created = await json(await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: {},
    }), env));
    const path = `/v1/rooms/${created.roomCode}`;
    const guest = await json(await worker.fetch(apiRequest(`${path}/join`, {
      method: "POST",
      token: "second",
      body: {},
    }), env));

    await worker.fetch(apiRequest(`${path}/ready`, {
      method: "POST",
      seatToken: created.seatToken,
      body: { ready: true },
    }), env);
    const finalReady = await worker.fetch(apiRequest(`${path}/ready`, {
      method: "POST",
      token: "second",
      seatToken: guest.seatToken,
      body: { ready: true },
    }), env);

    assert.equal((await json(finalReady)).room.phase, "ready");
  });

  it("lets a player leave and releases that seat for the next opponent", async () => {
    const { worker, env } = setup();
    const created = await json(await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: {},
    }), env));
    const roomPath = `/v1/rooms/${created.roomCode}`;
    const guest = await json(await worker.fetch(apiRequest(`${roomPath}/join`, {
      method: "POST",
      token: "second",
      body: {},
    }), env));

    const leave = await worker.fetch(apiRequest(`${roomPath}/leave`, {
      method: "POST",
      seatToken: created.seatToken,
      body: {},
    }), env);
    assert.equal(leave.status, 200);
    assert.deepEqual(await json(leave), { left: true });

    const state = await worker.fetch(apiRequest(`${roomPath}/state`, {
      token: "second",
      seatToken: guest.seatToken,
    }), env);
    const updated = await json(state);
    assert.equal(updated.room.players[0], null);
    assert.equal(updated.room.players[1].displayName, "Two");
    assert.equal(updated.room.phase, "waiting");

    const replacement = await worker.fetch(apiRequest(`${roomPath}/join`, {
      method: "POST",
      token: "third",
      body: {},
    }), env);
    assert.equal(replacement.status, 200);
    assert.equal((await json(replacement)).seat, 0);
  });

  it("does not authenticate health checks and rejects protected requests without a token", async () => {
    const { worker, env } = setup();
    const health = await worker.fetch(new Request("https://worker.test/health"), env);
    const privateState = await worker.fetch(apiRequest("/v1/rooms/0042/state", { token: null }), env);

    assert.equal(health.status, 200);
    assert.deepEqual(await json(health), { status: "ok" });
    assert.equal(privateState.status, 401);
  });

  it("rejects oversized request bodies before processing room commands", async () => {
    const { worker, env } = setup();
    const oversized = new Request("https://worker.test/v1/rooms", {
      method: "POST",
      headers: {
        Authorization: "Bearer ok",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "x".repeat(5_000) }),
    });
    const response = await worker.fetch(oversized, env);

    assert.equal(response.status, 400);
    assert.deepEqual(await json(response), { error: "invalid_request" });
  });
});
