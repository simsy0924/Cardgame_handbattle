import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_DEFINITIONS, createDuel, duelSnapshot, executeDuelCommand } from "../src/duel.js";
import { Engine } from "../src/engine.mjs";

const byName = Object.fromEntries(CARD_DEFINITIONS.map((card) => [card.name, card.id]));

function editableEngine(game) {
  const engine = new Engine(CARD_DEFINITIONS);
  engine.state = structuredClone(game.state);
  return engine;
}

test("starts with five cards, a shuffled shared starter deck, and a private opponent hand", () => {
  const game = createDuel();
  const snapshot = duelSnapshot(game, 0);
  const mainCount = CARD_DEFINITIONS.filter((card) => card.deck === "main").length;
  const keyCount = CARD_DEFINITIONS.filter((card) => card.deck === "key").length;

  const firstPlayer = game.state.turn.player;
  const secondPlayer = firstPlayer === "A" ? "B" : "A";
  assert.equal(game.state.players[firstPlayer].hand.length, 6);
  assert.equal(game.state.players[secondPlayer].hand.length, 7);
  assert.equal(game.state.players.A.deck.length, mainCount * 3 - game.state.players.A.hand.length);
  assert.equal(game.state.players.B.deck.length, mainCount * 3 - game.state.players.B.hand.length);
  assert.equal(game.state.players.A.keydeck.length, keyCount);
  assert.equal(snapshot.players[1].hand.every((card) => card.hidden && card.uid === null && card.name === null), true);
  assert.equal(snapshot.players[0].hand.every((card) => !card.hidden && card.uid && card.name), true);
  assert.equal(game.state.turn.phase, "deploy");
  assert.equal(game.state.turn.number, 1);
});

test("a legal normal summon moves one main-deck monster to the field once per turn", () => {
  const game = createDuel();
  const engine = editableEngine(game);
  engine.state.turn = { player: "A", phase: "deploy", number: 1 };
  const summoned = engine.addCard(byName["현자 펭귄"], "A", "hand");
  game.state = engine.state;

  const afterSummon = executeDuelCommand(game, 0, { type: "normal_summon", uid: summoned });
  assert.equal(afterSummon.state.cards[summoned].zone, "field");
  assert.equal(afterSummon.state.players.A.field.includes(summoned), true);

  const updatedEngine = editableEngine(afterSummon);
  const extra = updatedEngine.addCard(byName["펭귄 부부"], "A", "hand");
  afterSummon.state = updatedEngine.state;
  assert.throws(
    () => executeDuelCommand(afterSummon, 0, { type: "normal_summon", uid: extra }),
    (error) => error.code === "invalid_summon",
  );
});

test("the second player draws when their first turn begins", () => {
  const game = createDuel();
  const engine = editableEngine(game);
  const firstPlayer = engine.state.turn.player;
  const secondPlayer = firstPlayer === "A" ? "B" : "A";
  for (const player of ["A", "B"]) {
    for (const uid of [...engine.state.players[player].hand]) {
      if (engine.def(uid).effects.some((effect) => effect.timing?.event?.type === "added_to_hand")) {
        engine.moveCard(uid, "grave");
      }
    }
  }
  engine.state.pending = [];
  game.state = engine.state;
  const secondHandBefore = game.state.players[secondPlayer].hand.length;
  const firstSeat = firstPlayer === "A" ? 0 : 1;

  let next = executeDuelCommand(game, firstSeat, { type: "next_phase" });
  next = executeDuelCommand(next, firstSeat, { type: "next_phase" });
  next = executeDuelCommand(next, firstSeat, { type: "next_phase" });

  assert.equal(next.state.turn.player, secondPlayer);
  assert.equal(next.state.players[secondPlayer].hand.length, secondHandBefore + 1);
});

test("card choices pause the action and only the prompted player can resume it", () => {
  const game = createDuel();
  const engine = editableEngine(game);
  engine.state.turn = { player: "A", phase: "deploy", number: 1 };
  const killShot = engine.state.players.A.keydeck.find((uid) => engine.def(uid).name === "일격필살");
  engine.moveCard(killShot, "hand", { revealed: true });
  for (const uid of [...engine.state.players.B.hand]) engine.moveCard(uid, "deck");
  engine.addCard(byName["현자 펭귄"], "B", "hand");
  engine.addCard(byName["수문장 펭귄"], "B", "hand");
  engine.state.pending = [];
  game.state = engine.state;

  let paused = executeDuelCommand(game, 0, { type: "activate", uid: killShot, effectId: "e1" });
  assert.ok(paused.pending);
  assert.equal(duelSnapshot(paused, 0).pendingChoice.waiting, true);
  assert.throws(
    () => executeDuelCommand(paused, 0, { type: "choice", values: ["0"] }),
    (error) => error.code === "not_prompted_player",
  );

  while (paused.pending.prompt.type === "respond") {
    const responderSeat = paused.pending.prompt.player === "A" ? 0 : 1;
    paused = executeDuelCommand(paused, responderSeat, { type: "choice", values: ["pass"] });
  }
  const prompt = duelSnapshot(paused, 1).pendingChoice;
  assert.equal(prompt.waiting, false);
  assert.equal(prompt.options.length, 2);

  const finished = executeDuelCommand(paused, 1, { type: "choice", values: [prompt.options[0].value] });
  assert.equal(finished.pending, null);
  assert.equal(finished.state.players.B.hand.length, 1);
  assert.equal(finished.state.players.B.grave.length, 1);
});
