import assert from "node:assert/strict";
import { test } from "node:test";
import { createDuel, defaultPlayerDeck } from "../../server/src/duel.js";
import { MatchError, MatchStore } from "../src/game-store.mjs";

function storeStartingOnAiTurn() {
  const factory = () => {
    const game = createDuel([defaultPlayerDeck(), defaultPlayerDeck()]);
    game.state.turn = { player: "B", phase: "deploy", number: 1 };
    return game;
  };
  return new MatchStore({ duelFactory: factory });
}

test("AI viewpoint keeps the human hand hidden and includes its own visible card details", () => {
  const store = new MatchStore();
  const created = store.create({ aiDeck: { name: "Test AI", ...defaultPlayerDeck() } });
  const state = store.getState(created.code, 1);
  const human = state.snapshot.players[0];
  const ai = state.snapshot.players[1];

  assert.equal(human.hand.every((card) => card.hidden && card.name === null && card.uid === null && card.id === null), true);
  assert.equal(ai.hand.every((card) => !card.hidden && card.uid && card.id && card.description), true);
  assert.equal(state.aiName, "Test AI");
});

test("AI receives revision-bound legal actions and can execute only the current action ID", () => {
  const store = storeStartingOnAiTurn();
  const created = store.create({ aiDeck: defaultPlayerDeck() });
  const legal = store.getLegalActions(created.code);
  assert.equal(legal.canAct, true);
  assert.ok(legal.actions.some((action) => action.command.type === "next_phase"));

  const action = legal.actions.find((item) => item.command.type === "next_phase");
  const after = store.applyAiAction(created.code, { actionId: action.actionId });
  assert.equal(after.revision, 1);
  assert.equal(after.snapshot.phase, "attack");
  assert.throws(
    () => store.applyAiAction(created.code, { actionId: action.actionId }),
    (error) => error instanceof MatchError && error.code === "stale_action",
  );
});

test("the MCP AI seat cannot act during the human player's turn", () => {
  const store = new MatchStore({
    duelFactory: () => {
      const game = createDuel([defaultPlayerDeck(), defaultPlayerDeck()]);
      game.state.turn = { player: "A", phase: "deploy", number: 1 };
      return game;
    },
  });
  const created = store.create({ aiDeck: defaultPlayerDeck() });
  const legal = store.getLegalActions(created.code);
  assert.equal(legal.canAct, false);
  assert.throws(
    () => store.applyAiAction(created.code, { actionId: "r0-a0" }),
    (error) => error instanceof MatchError && error.code === "not_ai_turn",
  );
});

test("invalid user decks and expired game codes are rejected", () => {
  const store = new MatchStore({ now: () => 10_000 });
  assert.throws(
    () => store.create(),
    (error) => error instanceof MatchError && error.code === "ai_deck_required",
  );
  assert.throws(
    () => store.create({ aiDeck: { main: ["generic_001"], key: [] } }),
    (error) => error.code === "invalid_deck" || error.code === "invalid_input",
  );
  const created = store.create({ aiDeck: defaultPlayerDeck() });
  let now = 0;
  const expiredStore = new MatchStore({ now: () => now });
  const another = expiredStore.create({ aiDeck: defaultPlayerDeck() });
  now = 7 * 60 * 60 * 1000;
  assert.throws(
    () => expiredStore.getState(another.code),
    (error) => error instanceof MatchError && error.code === "game_expired",
  );
  assert.ok(created.code);
});
