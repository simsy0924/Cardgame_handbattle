import assert from "node:assert/strict";
import { test } from "node:test";
import { createDuel, defaultPlayerDeck, executeDuelCommand } from "../../server/src/duel.js";
import { MatchStore } from "../src/game-store.mjs";
import { dispatchApiRequest } from "../src/http-server.mjs";
function passStoreWindows(store, code) {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const human = store.getState(code, 0).snapshot.pendingChoice;
    const ai = store.getState(code, 1).snapshot.pendingChoice;
    if (human && !human.waiting) {
      store.applyHumanCommand(code, { type: "choice", values: ["pass"] });
      continue;
    }
    if (ai && !ai.waiting) {
      store.applyAiAction(code, { choiceValues: ["pass"] });
      continue;
    }
    if (!human && !ai) return store.getState(code, 0);
  }
  throw new Error("Quick-timing windows did not finish after consecutive passes.");
}

function passResponseWindows(game) {
  let attempts = 0;
  while (game.pending?.prompt.type === "respond" && attempts++ < 100) {
    const player = game.pending.prompt.player === "A" ? 0 : 1;
    game = executeDuelCommand(game, player, { type: "choice", values: ["pass"] });
  }
  return game;
}


test("API routes return the card list and start a match with the supplied AI deck", () => {
  const store = new MatchStore();
  const cards = dispatchApiRequest({ store, method: "GET", pathname: "/api/cards" });
  assert.equal(cards.status, 200);
  assert.ok(cards.body.cards.some((card) => card.description));
  assert.equal(dispatchApiRequest({ store, method: "GET", pathname: "/api/demo-deck" }), null);
  assert.throws(
    () => dispatchApiRequest({ store, method: "POST", pathname: "/api/games", body: { ai_name: "GPT" } }),
    (error) => error.code === "ai_deck_required",
  );

  const created = dispatchApiRequest({
    store,
    method: "POST",
    pathname: "/api/games",
    body: { ai_name: "GPT", ai_deck: { name: "Demo", ...defaultPlayerDeck() } },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.aiName, "GPT");
  assert.equal(created.body.snapshot.players[0].hand.length, created.body.snapshot.players[0].handCount);

  const current = dispatchApiRequest({
    store,
    method: "GET",
    pathname: "/api/games/" + created.body.code.toLowerCase() + "/state",
  });
  assert.equal(current.body.code, created.body.code);
  assert.ok(current.body.snapshot.players[0].hand.every((card) => !card.hidden));
});

test("human and manual AI routes both use the same authoritative command engine", () => {
  const humanStore = new MatchStore({
    duelFactory: (decks) => {
      const game = passResponseWindows(createDuel(decks));
      game.state.turn = { player: "A", phase: "deploy", number: 1 };
      return game;
    },
  });
  const humanGame = humanStore.create({ aiDeck: defaultPlayerDeck() });
  const humanResult = dispatchApiRequest({
    store: humanStore,
    method: "POST",
    pathname: "/api/games/" + humanGame.code + "/action",
    body: { command: { type: "next_phase" } },
  });
  assert.equal(humanResult.body.revision, 1);
  assert.equal(passStoreWindows(humanStore, humanGame.code).snapshot.phase, "attack");

  const aiStore = new MatchStore({
    duelFactory: (decks) => {
      const game = passResponseWindows(createDuel(decks));
      game.state.turn = { player: "B", phase: "deploy", number: 1 };
      return game;
    },
  });
  const aiGame = aiStore.create({ aiDeck: defaultPlayerDeck() });
  const aiMoves = aiStore.getLegalActions(aiGame.code);
  assert.equal(aiMoves.canAct, true);
  const nextPhase = aiMoves.actions.find((action) => action.command.type === "next_phase");
  const applied = dispatchApiRequest({
    store: aiStore,
    method: "POST",
    pathname: "/api/games/" + aiGame.code + "/ai-action",
    body: { action_id: nextPhase.actionId },
  });
  assert.equal(applied.body.revision, 1);
  assert.equal(passStoreWindows(aiStore, aiGame.code).snapshot.phase, "attack");
});

test("does not route unknown API paths and rejects malformed game setup bodies", () => {
  const store = new MatchStore();
  assert.equal(dispatchApiRequest({ store, method: "GET", pathname: "/api/missing" }), null);
  assert.throws(
    () => dispatchApiRequest({ store, method: "POST", pathname: "/api/games", body: [] }),
    /설정 JSON 객체/,
  );
});
