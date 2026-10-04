import assert from "node:assert/strict";
import { test } from "node:test";
import { createDuel, defaultPlayerDeck } from "../../server/src/duel.js";
import { MatchStore } from "../src/game-store.mjs";
import { handleMcpMessage } from "../src/http-server.mjs";

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
});

test("read MCP tools expose only the AI perspective and provide its legal moves", () => {
  const store = new MatchStore({
    duelFactory: (decks) => {
      const game = createDuel(decks);
      game.state.turn = { player: "B", phase: "deploy", number: 1 };
      return game;
    },
  });
  const game = store.create({ aiDeck: defaultPlayerDeck() });
  const stateResult = handleMcpMessage(store, {
    jsonrpc: "2.0",
    id: "state",
    method: "tools/call",
    params: { name: "get_duel_state", arguments: { game_code: game.code } },
  }).body.result;
  assert.equal(stateResult.isError, undefined);
  const aiState = stateResult.structuredContent;
  assert.equal(aiState.snapshot.players[0].hand.every((card) => card.hidden && card.id === undefined), true);
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
