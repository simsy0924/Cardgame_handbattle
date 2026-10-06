import assert from "node:assert/strict";
import { test } from "node:test";
import { createDuel, defaultPlayerDeck, executeDuelCommand } from "../../server/src/duel.js";
import { MatchStore } from "../src/game-store.mjs";
import { SUPPORTED_PROTOCOL_VERSIONS, handleMcpMessage, negotiateProtocolVersion } from "../src/http-server.mjs";

function passResponseWindows(game) {
  let attempts = 0;
  while (game.pending?.prompt.type === "respond" && attempts++ < 100) {
    const player = game.pending.prompt.player === "A" ? 0 : 1;
    game = executeDuelCommand(game, player, { type: "choice", values: ["pass"] });
  }
  return game;
}

function emptyDuel(player = "B", phase = "deploy") {
  const emptyPlayer = () => ({ hand: [], deck: [], grave: [], banished: [], keydeck: [], field: [], field_zone: [] });
  return {
    state: {
      seq: 0,
      cards: {},
      turn: { player, phase, number: 1 },
      players: { A: emptyPlayer(), B: emptyPlayer() },
      chain: [],
      pending: [],
    },
    rngState: 1,
    pending: null,
    winnerSeat: null,
    finished: false,
    initialLog: [],
  };
}

async function callTool(store, name, args) {
  const reply = await handleMcpMessage(store, {
    jsonrpc: "2.0",
    id: name,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return reply.body.result;
}

test("supports MCP initialization, tool discovery, and initialized notifications", async () => {
  const store = new MatchStore();
  const initialized = await handleMcpMessage(store, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  assert.equal(initialized.body.result.protocolVersion, "2025-06-18");
  assert.equal(initialized.body.result.capabilities.tools.listChanged, false);

  const listed = await handleMcpMessage(store, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = listed.body.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    "get_duel_state",
    "get_legal_actions",
    "get_card_catalog",
    "get_recent_events",
    "get_game_rules",
    "wait_for_action",
    "duel_action",
  ]);
  assert.equal(tools.find((tool) => tool.name === "duel_action").annotations.readOnlyHint, false);
  assert.equal(tools.find((tool) => tool.name === "get_duel_state").annotations.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === "wait_for_action").inputSchema.properties.timeout_seconds.maximum, 30);

  const notified = await handleMcpMessage(store, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notified.httpStatus, 202);
  assert.equal(notified.body, null);
  const clientResponse = await handleMcpMessage(store, { jsonrpc: "2.0", id: 9, result: {} });
  assert.equal(clientResponse.httpStatus, 202);
  assert.equal((await handleMcpMessage(store, { jsonrpc: "2.0", id: 9 })).httpStatus, 400);
});

test("negotiates ChatGPT and Claude protocol versions without falling back to an old version", async () => {
  const store = new MatchStore();
  for (const version of ["2026-07-28", "2026-01-26", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
    const reply = await handleMcpMessage(store, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version } });
    assert.equal(reply.body.result.protocolVersion, version);
  }
  const unknown = await handleMcpMessage(store, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2027-01-01" } });
  assert.equal(unknown.body.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
  assert.equal(negotiateProtocolVersion(undefined), "2026-07-28");
});

test("MCP state exposes chain context, current turn, and compact card IDs", async () => {
  const store = new MatchStore({ duelFactory: (decks) => {
    const game = passResponseWindows(createDuel(decks));
    game.state.turn = { player: "B", phase: "deploy", number: 1 };
    return game;
  } });
  const game = store.create({ aiDeck: defaultPlayerDeck() });
  const state = (await callTool(store, "get_duel_state", { game_code: game.code })).structuredContent;
  assert.equal(state.aiToolSeen, true);
  assert.equal(state.snapshot.turnPlayer, "B");
  assert.ok(Array.isArray(state.snapshot.chain));
  assert.equal(state.snapshot.players[0].hand.every((card) => card.hidden && card.id === null), true);
  assert.equal(state.snapshot.players[1].hand.every((card) => card.id && !Object.hasOwn(card, "description")), true);

  const actions = (await callTool(store, "get_legal_actions", { game_code: game.code })).structuredContent;
  assert.equal(actions.canAct, true);
  assert.equal(actions.turnPlayer, "B");
  assert.ok(actions.actions.length > 0);
  assert.ok(actions.actions.every((action) => action.actionId.startsWith("r0-a")));
});

test("duel_action returns only the changed state and recent events can be read by cursor", async () => {
  const store = new MatchStore({ duelFactory: () => emptyDuel("B", "deploy") });
  const game = store.create({ aiDeck: defaultPlayerDeck() });
  const legal = (await callTool(store, "get_legal_actions", { game_code: game.code })).structuredContent;
  const advance = legal.actions.find((action) => action.command.type === "next_phase");
  const applied = (await callTool(store, "duel_action", { game_code: game.code, action_id: advance.actionId })).structuredContent;

  assert.equal(Object.hasOwn(applied, "state"), false);
  assert.equal(applied.delta.fromRevision, 0);
  assert.equal(applied.delta.revision, 1);
  assert.equal(applied.delta.phase, "attack");
  assert.ok(applied.delta.recentEvents.some((event) => event.text.includes("행동: B 단계 이동")));

  const events = (await callTool(store, "get_recent_events", { game_code: game.code, after_event_id: 0, limit: 10 })).structuredContent;
  assert.equal(events.events[0].id, 1);
  assert.equal(events.events[0].revision, 1);
  const next = (await callTool(store, "get_recent_events", { game_code: game.code, after_event_id: events.eventCursor })).structuredContent;
  assert.deepEqual(next.events, []);
});

test("wait_for_action wakes when the human ends their turn, and reports timeout explicitly", async () => {
  const store = new MatchStore({ duelFactory: () => emptyDuel("A", "end") });
  const game = store.create({ aiDeck: defaultPlayerDeck() });
  const waiting = callTool(store, "wait_for_action", { game_code: game.code, timeout_seconds: 2 });
  setTimeout(() => store.applyHumanCommand(game.code, { type: "next_phase" }), 10);
  const ready = (await waiting).structuredContent;
  assert.equal(ready.ready, true);
  assert.equal(ready.canAct, true);
  assert.equal(ready.turnPlayer, "B");
  assert.equal(ready.timedOut, false);

  const timeoutStore = new MatchStore({ duelFactory: () => emptyDuel("A", "deploy") });
  const timeoutGame = timeoutStore.create({ aiDeck: defaultPlayerDeck() });
  const timedOut = (await callTool(timeoutStore, "wait_for_action", { game_code: timeoutGame.code, timeout_seconds: 1 })).structuredContent;
  assert.equal(timedOut.ready, false);
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.turnPlayer, "A");
});

test("MCP errors remain readable for stale or unknown game inputs", async () => {
  const result = await callTool(new MatchStore(), "get_duel_state", { game_code: "00000000000000000000000000000000" });
  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error.message, /찾을 수 없거나 만료/);
});
