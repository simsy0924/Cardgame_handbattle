import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/engine.mjs";

function activationCard(id, { type = "monster", turn = "both", phase = "all", activation_type } = {}) {
  return {
    id,
    name: id,
    type,
    effects: [{
      id: "e1",
      ...(activation_type ? { activation_type } : {}),
      timing: { turn, phase, event: null },
      cost: { pay: [], targets: [] },
      action: [{ steps: [{ type: "restrict", what: id, players: "both" }] }],
    }],
  };
}

function inertCard(id) {
  return { id, name: id, type: "normal", effects: [] };
}

test("turn start opens draw-start and draw-end windows, but skips both on the first turn", () => {
  const quick = activationCard("quick", { type: "spell", turn: "both", phase: "all" });
  const drawCard = inertCard("draw-card");
  const seen = [];
  const engine = new Engine([quick, drawCard], {
    respond(args) {
      seen.push({ player: args.player, window: args.window, chain: args.chain });
      return null;
    },
  });
  engine.addCard("quick", "A", "hand");
  engine.addCard("quick", "B", "hand");
  engine.addCard("draw-card", "A", "deck");

  engine.startTurn("A");

  assert.deepEqual(seen.map(({ player, window }) => [player, window]), [
    ["A", "draw_start"],
    ["B", "draw_start"],
    ["A", "draw_end"],
    ["B", "draw_end"],
    ["A", "phase_start"],
    ["B", "phase_start"],
  ]);
  assert.equal(engine.S.draws.A, 1);
  assert.equal(engine.S.turn.phase, "deploy");

  const firstTurnSeen = [];
  const firstTurn = new Engine([quick, drawCard], {
    respond(args) {
      firstTurnSeen.push(args.window);
      return null;
    },
  });
  firstTurn.addCard("quick", "A", "hand");
  firstTurn.addCard("quick", "B", "hand");
  firstTurn.addCard("draw-card", "A", "deck");
  firstTurn.startTurn("A", { first: true });

  assert.deepEqual(firstTurnSeen, ["phase_start", "phase_start"]);
  assert.equal(firstTurn.S.draws.A, 0);
  assert.equal(firstTurn.S.players.A.deck.length, 1);
});

test("free timing windows offer quick effects, not ignition or Spell Speed 1 effects", () => {
  const ignition = activationCard("ignition", { type: "monster", turn: "self", phase: "deploy" });
  const explicitQuick = activationCard("explicit-quick", {
    type: "monster",
    turn: "self",
    phase: "deploy",
    activation_type: "quick",
  });
  const normalSpell = activationCard("normal-spell", { type: "spell", turn: "self", phase: "deploy" });
  const trap = activationCard("trap", { type: "trap", turn: "opponent", phase: "all" });
  const engine = new Engine([ignition, explicitQuick, normalSpell, trap]);
  const ignitionUid = engine.addCard("ignition", "A", "hand");
  const quickUid = engine.addCard("explicit-quick", "A", "hand");
  const spellUid = engine.addCard("normal-spell", "A", "hand");
  const trapUid = engine.addCard("trap", "B", "hand");

  const fastA = engine.options("A", false, { fastOnly: true }).map((option) => option.uid);
  const fastB = engine.options("B", false, { fastOnly: true }).map((option) => option.uid);
  const activeA = engine.activatableEffects("A").map((option) => option.uid);

  assert.deepEqual(fastA, [quickUid]);
  assert.deepEqual(fastB, [trapUid]);
  assert.ok(activeA.includes(ignitionUid));
  assert.ok(activeA.includes(spellUid));
  assert.ok(activeA.includes(quickUid));
});

test("a quick effect can be activated after a chain has fully resolved", () => {
  const source = activationCard("source", { type: "monster", turn: "both", phase: "all" });
  const responder = activationCard("responder", { type: "trap", turn: "both", phase: "all" });
  let responderUid = null;
  let responderActivated = false;
  const seen = [];
  const engine = new Engine([source, responder], {
    respond(args) {
      seen.push({
        player: args.player,
        window: args.window,
        chainLength: args.chain.length,
        optionUids: args.options.map((option) => option.uid),
      });
      if (args.window === "after_resolution" && args.player === "B" && !responderActivated) {
        const option = args.options.find((candidate) => candidate.uid === responderUid);
        if (option) {
          responderActivated = true;
          return option;
        }
      }
      return null;
    },
  });
  const sourceUid = engine.addCard("source", "A", "hand");
  responderUid = engine.addCard("responder", "B", "hand");

  engine.activate(sourceUid, "e1");

  assert.ok(seen.some((entry) =>
    entry.window === "after_resolution" &&
    entry.player === "A" &&
    entry.chainLength === 0));
  assert.ok(seen.some((entry) =>
    entry.window === "after_resolution" &&
    entry.player === "B" &&
    entry.chainLength === 0 &&
    entry.optionUids.includes(responderUid)));
  assert.equal(responderActivated, true);
  assert.equal(engine.S.cards[responderUid].zone, "grave");
  assert.ok(engine.S.restrictions.some((restriction) => restriction.what === "responder"));
});

test("when the turn player advances a phase, the opponent gets the first fast-effect window", () => {
  const opponentQuick = activationCard("opponent-quick", { type: "monster", turn: "opponent", phase: "deploy" });
  const seen = [];
  const engine = new Engine([opponentQuick], {
    respond(args) {
      seen.push(args);
      return null;
    },
  });
  engine.addCard("opponent-quick", "B", "hand");

  engine.phaseBoundaryWindow();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].player, "B");
  assert.equal(seen[0].window, "phase_end");
  assert.deepEqual(seen[0].chain, []);
});

test("fast-effect windows do not offer the separate key-card fetch procedure", () => {
  const keyCard = { id: "key", name: "key", type: "monster", fetch: {}, effects: [] };
  const seen = [];
  const engine = new Engine([keyCard], {
    respond(args) {
      seen.push(args);
      return null;
    },
  });
  const uid = engine.addCard("key", "A", "keydeck");

  engine.quickEffectWindow({ window: "phase_start" });
  engine.phaseBoundaryWindow();

  assert.deepEqual(engine.fetchOptions("A"), [{ fetch: true, uid }]);
  assert.equal(seen.length, 0);
});
