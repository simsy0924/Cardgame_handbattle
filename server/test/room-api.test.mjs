import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../src/index.js";
import { CARD_DEFINITIONS, defaultPlayerDeck } from "../src/duel.js";
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

async function passPendingQuickWindows(worker, env, path, first, second) {
  const participants = [
    { token: "ok", seatToken: first.seatToken },
    { token: "second", seatToken: second.seatToken },
  ];

  for (let attempts = 0; attempts < 100; attempts += 1) {
    const snapshots = await Promise.all(participants.map(async (participant) => {
      const response = await worker.fetch(apiRequest(`${path}/state`, {
        token: participant.token,
        seatToken: participant.seatToken,
      }), env);
      return json(response);
    }));
    const responder = snapshots.findIndex(({ room }) =>
      room.duel?.pendingChoice && !room.duel.pendingChoice.waiting);
    if (responder < 0) {
      assert.equal(snapshots.some(({ room }) => room.duel?.pendingChoice?.waiting), false);
      return snapshots;
    }

    const participant = participants[responder];
    const response = await worker.fetch(apiRequest(`${path}/action`, {
      method: "POST",
      token: participant.token,
      seatToken: participant.seatToken,
      body: { type: "choice", values: ["pass"] },
    }), env);
    const result = await json(response);
    assert.equal(response.status, 200, result.message ?? result.error);
  }

  throw new Error("Quick-timing windows did not finish after consecutive passes.");
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

  it("starts a private duel snapshot after both participants confirm", async () => {
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

    const firstReady = await worker.fetch(apiRequest(`${path}/ready`, {
      method: "POST",
      seatToken: created.seatToken,
      body: { ready: true },
    }), env);
    assert.equal((await json(firstReady)).room.phase, "waiting");
    const finalReady = await worker.fetch(apiRequest(`${path}/ready`, {
      method: "POST",
      token: "second",
      seatToken: guest.seatToken,
      body: { ready: true },
    }), env);

    const started = await json(finalReady);
    assert.equal(started.room.phase, "playing");
    const firstSeat = started.room.duel.turnSeat;
    await passPendingQuickWindows(worker, env, path, created, guest);
    assert.equal(started.room.duel.players[firstSeat].handCount, 6);
    assert.equal(started.room.duel.players[1 - firstSeat].handCount, 7);
    assert.equal(started.room.duel.players[0].hand.length, started.room.duel.players[0].handCount);
    assert.equal(started.room.duel.players[1].hand.length, started.room.duel.players[1].handCount);
    const opponentSeat = 1 - started.seat;
    assert.equal(started.room.duel.players[opponentSeat].hand.every((card) => card.hidden && !card.name && !card.uid), true);

    const activeSeat = started.room.duel.turnSeat;
    const activeToken = activeSeat === 0 ? created.seatToken : guest.seatToken;
    const activeBearer = activeSeat === 0 ? "ok" : "second";
    const nextPhase = await worker.fetch(apiRequest(`${path}/action`, {
      method: "POST",
      token: activeBearer,
      seatToken: activeToken,
      body: { type: "next_phase" },
    }), env);
    assert.equal(nextPhase.status, 200);
    const afterBoundaryPasses = await passPendingQuickWindows(worker, env, path, created, guest);
    assert.equal(afterBoundaryPasses[activeSeat].room.duel.phase, "attack");

    const wrongSeat = 1 - activeSeat;
    const wrongSeatResponse = await worker.fetch(apiRequest(`${path}/action`, {
      method: "POST",
      token: wrongSeat === 0 ? "ok" : "second",
      seatToken: wrongSeat === 0 ? created.seatToken : guest.seatToken,
      body: { type: "next_phase" },
    }), env);
    assert.equal(wrongSeatResponse.status, 400);
    assert.equal((await json(wrongSeatResponse)).error, "not_your_turn");
  });

  it("starts the match with the separate decks submitted by both players", async () => {
    const { rooms, worker, env } = setup();
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
    const mainIds = CARD_DEFINITIONS.filter((card) => card.deck === "main").slice(0, 10).map((card) => card.id);
    const customDeck = { main: mainIds.flatMap((id) => Array(4).fill(id)), key: defaultPlayerDeck().key.slice(0, 2) };

    const readyOne = await worker.fetch(apiRequest(`${path}/ready`, {
      method: "POST",
      seatToken: created.seatToken,
      body: { ready: true, deck: customDeck },
    }), env);
    assert.equal(readyOne.status, 200);
    assert.equal((await json(readyOne)).room.phase, "waiting");

    const readyTwo = await worker.fetch(apiRequest(`${path}/ready`, {
      method: "POST",
      token: "second",
      seatToken: guest.seatToken,
      body: { ready: true },
    }), env);
    const started = await json(readyTwo);
    assert.equal(started.room.phase, "playing");
    assert.equal(Object.hasOwn(started.room.players[0], "deck"), false);

    const savedRoom = await rooms.rooms.get(created.roomCode).ctx.storage.get("room");
    for (const [seat, player] of ["A", "B"].entries()) {
      const zones = savedRoom.game.state.players[player];
      const ids = [...zones.deck, ...zones.hand].map((uid) => savedRoom.game.state.cards[uid].id);
      const expectedMain = seat === 0 ? customDeck.main : defaultPlayerDeck().main;
      assert.equal(ids.length, expectedMain.length);
      for (const id of new Set(expectedMain)) {
        assert.equal(ids.filter((cardId) => cardId === id).length, expectedMain.filter((cardId) => cardId === id).length);
      }
      const expectedKey = seat === 0 ? customDeck.key : defaultPlayerDeck().key;
      assert.deepEqual(zones.keydeck.map((uid) => savedRoom.game.state.cards[uid].id).sort(), [...expectedKey].sort());
    }
  });

  it("rejects an illegal deck without marking the player ready", async () => {
    const { worker, env } = setup();
    const created = await json(await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: {},
    }), env));
    const response = await worker.fetch(apiRequest(`/v1/rooms/${created.roomCode}/ready`, {
      method: "POST",
      seatToken: created.seatToken,
      body: { ready: true, deck: { main: [], key: [] } },
    }), env);
    const result = await json(response);
    assert.equal(response.status, 400);
    assert.equal(result.error, "invalid_deck");
    assert.equal(result.message.includes("40~60장"), true);

    const state = await json(await worker.fetch(apiRequest(`/v1/rooms/${created.roomCode}/state`, {
      seatToken: created.seatToken,
    }), env));
    assert.equal(state.room.players[0].ready, false);
  });

  it("rejects a deck with more than ten key cards", async () => {
    const { worker, env } = setup();
    const created = await json(await worker.fetch(apiRequest("/v1/rooms", {
      method: "POST",
      body: {},
    }), env));
    const mainIds = CARD_DEFINITIONS.filter((card) => card.deck === "main").slice(0, 10).map((card) => card.id);
    const keyIds = CARD_DEFINITIONS.filter((card) => card.deck === "key").map((card) => card.id);
    assert.equal(keyIds.length > 10, true);
    const response = await worker.fetch(apiRequest(`/v1/rooms/${created.roomCode}/ready`, {
      method: "POST",
      seatToken: created.seatToken,
      body: { ready: true, deck: { main: mainIds.flatMap((id) => Array(4).fill(id)), key: keyIds } },
    }), env);
    const result = await json(response);
    assert.equal(response.status, 400);
    assert.equal(result.error, "invalid_deck");
    assert.equal(result.message.includes("최대 10장"), true);
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
