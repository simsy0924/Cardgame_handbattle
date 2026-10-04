import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_DEFINITIONS, defaultPlayerDeck } from "../../server/src/duel.js";
import { normalizeDeckFile, validateDeck } from "../src/deck-format.mjs";

test("normalizes repeated IDs, count objects, and nested deck exports", () => {
  const mainIds = CARD_DEFINITIONS.filter((card) => card.deck === "main").slice(0, 10).map((card) => card.id);
  const keyId = CARD_DEFINITIONS.find((card) => card.deck === "key").id;
  const normalized = normalizeDeckFile({
    name: "Count format",
    deck: {
      main: mainIds.map((id) => ({ id, count: 4 })),
      key: { [keyId]: 1 },
    },
  });
  assert.equal(normalized.name, "Count format");
  assert.equal(normalized.main.length, 40);
  assert.equal(normalized.key[0], keyId);
  assert.deepEqual(validateDeck(normalized, CARD_DEFINITIONS), []);
});

test("accepts the game's default deck and rejects copy and key-deck limit violations", () => {
  const deck = defaultPlayerDeck();
  assert.deepEqual(validateDeck(deck, CARD_DEFINITIONS), []);

  const overCopies = { ...deck, main: [...deck.main, deck.main[0], deck.main[0]] };
  assert.ok(validateDeck(overCopies, CARD_DEFINITIONS).some((error) => error.includes("최대 4장")));

  const overKeyLimit = { ...deck, key: Array(11).fill(deck.key[0]) };
  assert.ok(validateDeck(overKeyLimit, CARD_DEFINITIONS).some((error) => error.includes("최대 10장")));
});

test("rejects invalid deck export shapes and counts", () => {
  assert.throws(() => normalizeDeckFile([]), /JSON 객체/);
  assert.throws(() => normalizeDeckFile({ main: ["x"] }), /main과 key/);
  assert.throws(() => normalizeDeckFile({ main: { card: -1 }, key: [] }), /0~60/);
});
