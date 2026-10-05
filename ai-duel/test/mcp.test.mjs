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


test("supports MCP initialization, tool discovery, and initialized notifications", () => {
  const store = new MatchStore();
  const initialized = handleMcpMessage(store, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  assert.equal(initialized.body.result.protocolVersion, "2025-06-18");
  assert.equal(initialized.body.result.capabilities.tools.listChanged, false);

  const listed = handleMcpMessage(store, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = listed.body.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), ["get_duel_state", "get_legal_actions", "get_card_catalog", "get_game_rules", "duel_action"]);
  assert.equal(tools.find((tool) => tool.name === "duel_action").annotations.readOnlyHint, false);
  assert.equal(tools.find((tool) => tool.name === "get_duel_state").annotations.readOnlyHint, true);

  const notified = handleMcpMessage(store, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notified.httpStatus, 202);
  assert.equal(notified.body, null);
  const clientResponse = handleMcpMessage(store, { jsonrpc: "2.0", id: 9, result: {} });
  assert.equal(clientResponse.httpStatus, 202);
  assert.equal(handleMcpMessage(store, { jsonrpc: "2.0", id: 9 }).httpStatus, 400);
});

test("negotiates the ChatGPT and Claude protocol versions and never falls back to an old one", () => {
  const store = new MatchStore();
  for (const version of ["2026-07-28", "2026-01-26", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
    const reply = handleMcpMessage(store, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version } });
    assert.equal(reply.body.result.protocolVersion, version);
  }
  const unknown = handleMcpMessage(store, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2027-01-01" } });
  assert.equal(unknown.body.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
  assert.equal(negotiateProtocolVersion(undefined), "2026-07-28");
});

test("read MCP tools expose only the AI perspective and provide its legal moves", () => {
  const store = new MatchStore({
    duelFactory: (decks) => {
      const game = passResponseWindows(createDuel(decks));
      game.state.turn = { player: "B", phase: "deploy", number: 1 };
      return game;
    },
  });
  const game = store.create({ aiDeck: defaultPlayerDeck() });
  assert.equal(store.getState(game.code, 0).aiToolSeen, false);
  const stateResult = handleMcpMessage(store, {
    jsonrpc: "2.0",
    id: "state",
    method: "tools/call",
    params: { name: "get_duel_state", arguments: { game_code: game.code } },
  }).body.result;
  assert.equal(stateResult.isError, undefined);
  const aiState = stateResult.structuredContent;
  assert.equal(aiState.aiToolSeen, true);
  assert.equal(store.getState(game.code, 0).aiToolSeen, true);
  assert.equal(aiState.snapshot.players[0].hand.every((card) => card.hidden && card.id === null), true);
  assert.equal(aiState.snapshot.players[1].hand.every((card) => card.id && card.description), true);

  const actions = handleMcpMessage(store, {
    jsonrpc: "2.0",
    id: "actions",
    method: "tools/call",
    params: { name: "get_legal_actions", arguments: { game_code: game.code } },
  }).body.result.structuredContent;
  assert.equal(actions.canAct, true);
  assert.ok(actions.actions.length > 0);
  assert.ok(actions.actions.every((action) => action.actionId.startsWith("r0-a")));
});

test("MCP game actions return a readable tool error for stale or unknown game inputs", () => {
  const result = handleMcpMessage(new MatchStore(), {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_duel_state", arguments: { game_code: "00000000000000000000000000000000" } },
  });
  assert.equal(result.body.result.isError, true);
  assert.match(result.body.result.structuredContent.error.message, /찾을 수 없거나 만료/);
});
