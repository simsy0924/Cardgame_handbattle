import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CARD_DEFINITIONS,
  createDuel,
  defaultPlayerDeck,
  duelSnapshot,
  executeDuelCommand,
  validatePlayerDeck,
} from "../src/duel.js";
import { Engine } from "../src/engine.mjs";

const byName = Object.fromEntries(CARD_DEFINITIONS.map((card) => [card.name, card.id]));

function editableEngine(game) {
  const engine = new Engine(CARD_DEFINITIONS);
  engine.state = structuredClone(game.state);
  return engine;
}

function passResponseWindows(game) {
  let attempts = 0;
  while (game.pending?.prompt.type === "respond" && attempts++ < 100) {
    const prompt = game.pending.prompt;
    game = executeDuelCommand(game, prompt.player === "A" ? 0 : 1, {
      type: "choice",
      values: ["pass"],
    });
  }
  return game;
}

function createDuelAndPassQuickWindows(decks) {
  const game = passResponseWindows(createDuel(decks));
  assert.equal(game.pending, null);
  return game;
}

test("starts with five cards, a shuffled shared starter deck, and a private opponent hand", () => {
  const game = createDuel();
  const snapshot = duelSnapshot(game, 0);
  const mainCount = defaultPlayerDeck().main.length / 3;
  const keyCount = defaultPlayerDeck().key.length;

  if (game.pending) {
    assert.equal(game.pending.prompt.window, "phase_start");
    const firstPromptSeat = game.pending.prompt.player === "A" ? 0 : 1;
    assert.match(duelSnapshot(game, firstPromptSeat).pendingChoice.title, /퀵타이밍/);
  }
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

test("accepts 40 to 60 main cards, at most four copies, and up to ten key cards", () => {
  const mainIds = CARD_DEFINITIONS.filter((card) => card.deck === "main").slice(0, 10).map((card) => card.id);
  const availableKeyIds = CARD_DEFINITIONS.filter((card) => card.deck === "key").map((card) => card.id);
  const legalDeck = { main: mainIds.flatMap((id) => Array(4).fill(id)), key: availableKeyIds.slice(0, 10) };
  assert.equal(validatePlayerDeck(legalDeck).main.length, 40);
  assert.equal(validatePlayerDeck(legalDeck).key.length, 10);
  assert.throws(
    () => validatePlayerDeck({ ...legalDeck, main: legalDeck.main.slice(1) }),
    (error) => error.code === "invalid_deck",
  );
  assert.throws(
    () => validatePlayerDeck({ ...legalDeck, main: [...legalDeck.main, mainIds[0]] }),
    (error) => error.code === "invalid_deck",
  );
  assert.throws(
    () => validatePlayerDeck({ ...legalDeck, key: availableKeyIds }),
    (error) => error.code === "invalid_deck",
  );
  assert.throws(
    () => validatePlayerDeck({ ...legalDeck, key: [legalDeck.key[0], legalDeck.key[0]] }),
    (error) => error.code === "invalid_deck",
  );
  assert.throws(
    () => validatePlayerDeck({ ...legalDeck, main: [...legalDeck.main.slice(0, 39), defaultPlayerDeck().key[0]] }),
    (error) => error.code === "invalid_deck",
  );
});

test("creates each player's game zones from that player's submitted deck", () => {
  const mainIds = CARD_DEFINITIONS.filter((card) => card.deck === "main").slice(0, 10).map((card) => card.id);
  const customDeck = { main: mainIds.flatMap((id) => Array(4).fill(id)), key: defaultPlayerDeck().key.slice(0, 2) };
  const game = createDuelAndPassQuickWindows([customDeck, defaultPlayerDeck()]);

  for (const [seat, player] of ["A", "B"].entries()) {
    const zones = game.state.players[player];
    const allMain = [...zones.deck, ...zones.hand].map((uid) => game.state.cards[uid].id);
    const expected = seat === 0 ? customDeck.main : defaultPlayerDeck().main;
    assert.equal(allMain.length, expected.length);
    for (const id of new Set(expected)) {
      assert.equal(allMain.filter((cardId) => cardId === id).length, expected.filter((cardId) => cardId === id).length);
    }
    const expectedKeys = seat === 0 ? customDeck.key : defaultPlayerDeck().key;
    assert.deepEqual(zones.keydeck.map((uid) => game.state.cards[uid].id).sort(), [...expectedKeys].sort());
  }
});

test("normal summons are unavailable and monsters can only be summoned by effects or key procedures", () => {
  const game = createDuelAndPassQuickWindows();
  const engine = editableEngine(game);
  engine.state.turn = { player: "A", phase: "deploy", number: 1 };
  const card = engine.addCard(byName["현자 펭귄"], "A", "hand");
  game.state = engine.state;

  assert.equal(duelSnapshot(game, 0).actions.some((action) => action.type === "normal_summon"), false);
  assert.throws(
    () => executeDuelCommand(game, 0, { type: "normal_summon", uid: card }),
    (error) => error.code === "invalid_action" && /일반 소환이 없습니다/.test(error.message),
  );
});

test("field card activation is available as a card action even with no activation effect", () => {
  let game = createDuelAndPassQuickWindows();
  const engine = editableEngine(game);
  engine.state.turn = { player: "A", phase: "deploy", number: 1 };
  const fieldCard = engine.addCard(byName["태평양 속 르뤼에"], "A", "hand");
  game.state = engine.state;

  const action = duelSnapshot(game, 0).actions.find((candidate) =>
    candidate.type === "activate_field_card" && candidate.uid === fieldCard);
  assert.ok(action);

  game = passResponseWindows(executeDuelCommand(game, 0, { type: action.type, uid: fieldCard }));
  assert.equal(game.pending, null);
  assert.equal(game.state.players.A.field_zone.some((uid) => game.state.cards[uid].id === byName["태평양 속 르뤼에"]), true);
});

test("the second player draws when their first turn begins", () => {
  const game = createDuelAndPassQuickWindows();
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

  let next = passResponseWindows(executeDuelCommand(game, firstSeat, { type: "next_phase" }));
  next = passResponseWindows(executeDuelCommand(next, firstSeat, { type: "next_phase" }));
  next = passResponseWindows(executeDuelCommand(next, firstSeat, { type: "next_phase" }));

  assert.equal(next.state.turn.player, secondPlayer);
  assert.equal(next.state.players[secondPlayer].hand.length, secondHandBefore + 1);
});

test("card choices pause the action and only the prompted player can resume it", () => {
  const game = createDuelAndPassQuickWindows();
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

  const finished = passResponseWindows(executeDuelCommand(paused, 1, { type: "choice", values: [prompt.options[0].value] }));
  assert.equal(finished.pending, null);
  assert.equal(finished.state.players.B.hand.length, 1);
  assert.equal(finished.state.players.B.grave.length, 1);
});
