import assert from "node:assert/strict";
import { test } from "node:test";
import genericDeck from "../src/cards/generic_deck.json" with { type: "json" };
import penguinDeck from "../src/cards/penguin_deck.json" with { type: "json" };
import elementsDeck from "../src/cards/elements_deck.json" with { type: "json" };
import cthulhuDeck from "../src/cards/cthulhu_deck.json" with { type: "json" };
import { Engine, unsupportedFeatures } from "../src/engine.mjs";
import { defaultPlayerDeck, validatePlayerDeck } from "../src/duel.js";

const definitions = [...genericDeck.cards, ...penguinDeck, ...elementsDeck.cards, ...cthulhuDeck.cards];
const engineOptions = {
  effectFilters: { ...genericDeck.effect_filters, ...elementsDeck.effect_filters },
  counterRules: elementsDeck.counter_rules,
};

test("both new themes use supported engine effects", () => {
  const unsupported = [...elementsDeck.cards, ...cthulhuDeck.cards].flatMap((card) =>
    card.effects.flatMap((effect) => unsupportedFeatures(effect).map((feature) => `${card.id}.${effect.id}:${feature}`)),
  );
  assert.deepEqual(unsupported, []);
});

test("default deck remains legal after the catalog grows", () => {
  const deck = defaultPlayerDeck();
  assert.equal(deck.main.length, 54);
  assert.equal(deck.key.length, 10);
  assert.deepEqual(validatePlayerDeck(deck), deck);
  assert.ok(deck.main.every((id) => !id.startsWith("elements_") && !id.startsWith("cthulhu_")));
});

test("a field card with no activation effect still enters the chain and resolves as a no-op", () => {
  const emptyField = { id: "test_field", name: "무효과 필드 카드", type: "field", activation_zone: "field_zone", effects: [] };
  const responder = {
    id: "test_responder",
    name: "응답 카드",
    type: "monster",
    effects: [{
      id: "e1",
      activation_type: "quick",
      timing: { turn: "both", phase: "all", event: null },
      condition: null,
      cost: { pay: [], isTargeting: false, targets: [] },
      action: [{ group: 1, apply: "simultaneous", allow_partial: false, steps: [{ type: "draw", player: "self", count: 1 }] }],
      limit: null,
      mandatory: false,
    }],
  };
  const seen = [];
  let responderUid;
  const engine = new Engine([...definitions, emptyField, responder], {
    ...engineOptions,
    respond(args) {
      seen.push(args);
      if (args.window === "chain_response" && args.player === "B") {
        return args.options.find((option) => option.uid === responderUid) ?? null;
      }
      return null;
    },
  });
  engine.S.turn = { player: "A", phase: "deploy", number: 1 };
  const oldFieldUid = engine.addCard("test_field", "A", "field_zone");
  const fieldUid = engine.addCard("test_field", "A", "hand");
  responderUid = engine.addCard("test_responder", "B", "field");
  engine.addCard("generic_001", "B", "deck");

  assert.deepEqual(engine.fieldActivationOptions("A"), [{ fieldActivation: true, uid: fieldUid }]);
  engine.activateFieldCard(fieldUid);

  const chainResponse = seen.find((entry) => entry.window === "chain_response");
  assert.equal(chainResponse.chain[0].kind, "field_activation");
  assert.equal(chainResponse.chain[0].uid, fieldUid);
  assert.equal(engine.S.cards[fieldUid].zone, "field_zone");
  assert.equal(engine.S.cards[oldFieldUid].zone, "grave");
  assert.equal(engine.S.chain.length, 0);
  assert.ok(engine.log.some((line) => line.includes("발동만 처리 (효과 없음)")));
  assert.equal(engine.S.players.B.hand.length, 1);
});

test("a field card activation can resolve its marked activation effect", () => {
  const engine = new Engine(definitions, engineOptions);
  engine.S.turn = { player: "A", phase: "deploy", number: 1 };
  const fieldUid = engine.addCard("elements_005", "A", "hand");
  engine.addCard("elements_001", "A", "deck");

  assert.equal(engine.activatableEffects("A").some((option) => option.uid === fieldUid), false);
  assert.deepEqual(engine.fieldActivationOptions("A"), [{ fieldActivation: true, uid: fieldUid }]);
  engine.activateFieldCard(fieldUid);

  assert.equal(engine.S.cards[fieldUid].zone, "field_zone");
  assert.equal(engine.S.players.A.hand.length, 1);
  assert.equal(engine.def(engine.S.players.A.hand[0]).id, "elements_001");
});

test("the Cthulhu starter effect can place R'lyeh in the field zone", () => {
  const engine = new Engine(definitions, engineOptions);
  engine.S.turn = { player: "A", phase: "deploy", number: 1 };
  const cthulhuUid = engine.addCard("cthulhu_001", "A", "hand");
  const rlyehUid = engine.addCard("cthulhu_002", "A", "deck");

  engine.activate(cthulhuUid, "e1");

  assert.equal(engine.S.cards[cthulhuUid].zone, "field");
  assert.equal(engine.S.cards[rlyehUid].zone, "field_zone");
});
