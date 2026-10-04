import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import catalog from "../src/cards/card_catalog.json" with { type: "json" };
import { CARD_DEFINITIONS } from "../src/duel.js";

test("the Android catalog has official display text for every server card", async () => {
  const catalogById = new Map(catalog.cards.map((card) => [card.id, card]));
  assert.equal(catalogById.size, CARD_DEFINITIONS.length);

  for (const definition of CARD_DEFINITIONS) {
    const display = catalogById.get(definition.id);
    assert.ok(display, `missing display data for ${definition.id}`);
    assert.equal(display.name, definition.name);
    assert.equal(display.type, definition.type);
    assert.equal(display.deck, definition.deck);
    assert.equal(display.attack, definition.attack ?? null);
    assert.ok(display.description.trim().length > 0, `missing official text for ${definition.id}`);
  }

  const bundled = JSON.parse(await readFile(new URL("../../app/src/main/assets/card_catalog.json", import.meta.url), "utf8"));
  assert.deepEqual(bundled, catalog);
});
