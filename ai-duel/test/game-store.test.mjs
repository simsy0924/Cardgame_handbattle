import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_DEFINITIONS, createDuel, defaultPlayerDeck, executeDuelCommand } from "../../server/src/duel.js";
import { MatchError, MatchStore } from "../src/game-store.mjs";


function passResponseWindows(game) {
  let attempts = 0;
  while (game.pending?.prompt.type === "respond" && attempts++ < 100) {
    const player = game.pending.prompt.player === "A" ? 0 : 1;
    game = executeDuelCommand(game, player, { type: "choice", values: ["pass"] });
  }
  return game;
}


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

function storeStartingOnAiTurn() {
  const factory = () => {
    const game = passResponseWindows(createDuel([defaultPlayerDeck(), defaultPlayerDeck()]));
    game.state.turn = { player: "B", phase: "deploy", number: 1 };
    return game;
  };
  return new MatchStore({ duelFactory: factory });
}

test("AI viewpoint keeps the human hand hidden and sends card IDs without repeating descriptions", () => {
  const store = new MatchStore();
  const created = store.create({ aiDeck: { name: "Test AI", ...defaultPlayerDeck() } });
  const state = store.getState(created.code, 1);
  const appState = store.getState(created.code, 0);
  const human = state.snapshot.players[0];
  const ai = state.snapshot.players[1];

  assert.equal(human.hand.every((card) => card.hidden && card.name === null && card.uid === null && card.id === null), true);
  assert.equal(ai.hand.every((card) => !card.hidden && card.uid && card.id && !Object.hasOwn(card, "description")), true);
  assert.equal(appState.snapshot.players[0].hand.every((card) => card.description), true);
  assert.equal(state.aiName, "Test AI");
});

test("AI state refresh reflects a human summon even when hand and deck counts stay the same", () => {
  const monster = CARD_DEFINITIONS.find((card) => card.id === "cthulhu_001");
  const game = createDuel([defaultPlayerDeck(), defaultPlayerDeck()]);
  game.pending = null;
  game.state.players.B.hand = [];
  game.state.players.B.field = [];
  game.state.turn = { player: "A", phase: "deploy", number: 1 };

  const addInstance = (id, zone) => {
    const uid = `${id}#test-${++game.state.seq}`;
    game.state.cards[uid] = { uid, id, owner: "A", zone, revealed: false, bonus: 0, ...(zone === "field" ? { ctrl: "A" } : {}) };
    game.state.players.A[zone].push(uid);
    return uid;
  };
  addInstance(monster.id, "field");
  addInstance(monster.id, "field");
  const keyUid = addInstance("generic_001", "keydeck");

  const store = new MatchStore({ duelFactory: () => game });
  const created = store.create({ aiDeck: defaultPlayerDeck() });
  const before = store.getState(created.code, 1).snapshot.players[0];
  const beforeHandCount = before.handCount;
  const beforeDeckCount = before.deckCount;
  assert.equal(before.field.length, 2);

  store.applyHumanCommand(created.code, { type: "key_summon", uid: keyUid });
  const after = store.getState(created.code, 1);
  const human = after.snapshot.players[0];
  const delta = store.getLatestDelta(created.code);
  assert.equal(after.revision, 1);
  assert.equal(human.handCount, beforeHandCount);
  assert.equal(human.deckCount, beforeDeckCount);
  assert.deepEqual(human.field.map((card) => card.id), ["generic_001"]);
  assert.ok(after.snapshot.recentEvents.some((event) => event.text.includes("키 카드 소환")));
  assert.ok(delta.changedZones.some((zone) => zone.seat === 0 && zone.zone === "field" && zone.added.some((card) => card.id === "generic_001")));
});

test("chain and choice context identify the effect and trigger without revealing hidden cards", () => {
  const game = createDuel([defaultPlayerDeck(), defaultPlayerDeck()]);
  game.pending = null;
  const aiUid = game.state.players.B.hand[0];
  const hiddenHumanUid = game.state.players.A.hand[0];
  game.state.chain = [{ kind: "effect", uid: aiUid, eid: "e2", player: "B", negated: false }];
  game.pending = {
    answers: [],
    prompt: {
      type: "confirm",
      player: "B",
      uid: aiUid,
      effectId: "e2",
      event: { type: "summoned", uid: hiddenHumanUid, player: "A" },
    },
  };
  const store = new MatchStore({ duelFactory: () => game });
  const created = store.create({ aiDeck: defaultPlayerDeck() });
  const snapshot = store.getState(created.code, 1).snapshot;

  assert.equal(snapshot.chain[0].effectId, "e2");
  assert.equal(snapshot.chain[0].effectNumber, 2);
  assert.match(snapshot.pendingChoice.title, /2번 효과/);
  assert.match(snapshot.pendingChoice.title, /소환/);
  assert.equal(snapshot.pendingChoice.context.trigger.card.hidden, true);
});

test("a fetch chain link hides an opponent's selected key card until it resolves", () => {
  const game = createDuel([defaultPlayerDeck(), defaultPlayerDeck()]);
  game.pending = null;
  const hiddenKeyUid = game.state.players.A.keydeck[0];
  game.state.chain = [{ kind: "fetch", uid: hiddenKeyUid, player: "A", negated: false }];
  const store = new MatchStore({ duelFactory: () => game });
  const created = store.create({ aiDeck: defaultPlayerDeck() });
  const link = store.getState(created.code, 1).snapshot.chain[0];
  assert.deepEqual(link.card, { uid: null, id: null, name: "비공개 키 카드", hidden: true });
});

test("AI receives revision-bound legal actions and can execute only the current action ID", () => {
  const store = storeStartingOnAiTurn();
  const created = store.create({ aiDeck: defaultPlayerDeck() });
  const legal = store.getLegalActions(created.code);
  assert.equal(legal.canAct, true);
  assert.ok(legal.actions.some((action) => action.command.type === "next_phase"));

  const action = legal.actions.find((item) => item.command.type === "next_phase");
  const pending = store.applyAiAction(created.code, { actionId: action.actionId });
  assert.equal(pending.revision, 1);
  const after = passStoreWindows(store, created.code);
  assert.equal(after.snapshot.phase, "attack");
  assert.throws(
    () => store.applyAiAction(created.code, { actionId: action.actionId }),
    (error) => error instanceof MatchError && error.code === "stale_action",
  );
});

test("the MCP AI seat cannot act during the human player's turn", () => {
  const store = new MatchStore({
    duelFactory: () => {
      const game = passResponseWindows(createDuel([defaultPlayerDeck(), defaultPlayerDeck()]));
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
