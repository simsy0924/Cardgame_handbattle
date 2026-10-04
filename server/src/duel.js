import { Engine, OTHER } from "./engine.mjs";
import genericDeck from "./cards/generic_deck.json" with { type: "json" };
import penguinDeck from "./cards/penguin_deck.json" with { type: "json" };

const PLAYERS = ["A", "B"];
const FIRST_OPENING_HAND_SIZE = 6;
const SECOND_OPENING_HAND_SIZE = 7;
const MAIN_COPIES = 4;
const KEY_DECK_MAX = 10;
const FIELD_MAX = 5;

export const CARD_DEFINITIONS = [...genericDeck.cards, ...penguinDeck];
const DEFINITIONS = Object.fromEntries(CARD_DEFINITIONS.map((card) => [card.id, card]));

export class DuelRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DuelRuleError";
    this.code = code;
  }
}

export function defaultPlayerDeck() {
  return {
    main: CARD_DEFINITIONS.filter((card) => card.deck === "main").flatMap((card) =>
      Array.from({ length: 3 }, () => card.id),
    ),
    key: CARD_DEFINITIONS.filter((card) => card.deck === "key").slice(0, KEY_DECK_MAX).map((card) => card.id),
  };
}

export function validatePlayerDeck(deck) {
  if (!deck || typeof deck !== "object" || Array.isArray(deck) ||
      !Array.isArray(deck.main) || !Array.isArray(deck.key)) {
    throw new DuelRuleError("invalid_deck", "메인 덱과 키 카드 덱 목록을 확인하세요.");
  }
  if (deck.main.length < 40 || deck.main.length > 60) {
    throw new DuelRuleError("invalid_deck", `메인 덱은 40~60장이어야 합니다. (현재 ${deck.main.length}장)`);
  }
  if (deck.key.length > KEY_DECK_MAX) {
    throw new DuelRuleError("invalid_deck", `키 카드 덱은 최대 ${KEY_DECK_MAX}장까지 넣을 수 있습니다. (현재 ${deck.key.length}장)`);
  }

  const definitions = new Map(CARD_DEFINITIONS.map((card) => [card.id, card]));
  const mainCounts = new Map();
  for (const id of deck.main) {
    if (typeof id !== "string" || definitions.get(id)?.deck !== "main") {
      throw new DuelRuleError("invalid_deck", "메인 덱에 메인 카드가 아닌 카드가 포함되어 있습니다.");
    }
    mainCounts.set(id, (mainCounts.get(id) ?? 0) + 1);
    if (mainCounts.get(id) > 4) {
      throw new DuelRuleError("invalid_deck", `메인 덱에는 같은 카드를 최대 4장 넣을 수 있습니다. (${definitions.get(id).name})`);
    }
  }

  const keyIds = new Set();
  for (const id of deck.key) {
    if (typeof id !== "string" || definitions.get(id)?.deck !== "key") {
      throw new DuelRuleError("invalid_deck", "키 카드 덱에 키 카드가 아닌 카드가 포함되어 있습니다.");
    }
    if (keyIds.has(id)) {
      throw new DuelRuleError("invalid_deck", `키 카드 덱에는 같은 카드를 1장만 넣을 수 있습니다. (${definitions.get(id).name})`);
    }
    keyIds.add(id);
  }

  return { main: [...deck.main], key: [...deck.key] };
}

class InputRequired extends Error {
  constructor(prompt) {
    super("A player choice is required");
    this.prompt = prompt;
  }
}

function randomSeed() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

function seatPlayer(seat) {
  return seat === 0 ? "A" : "B";
}

function playerSeat(player) {
  return player === "A" ? 0 : 1;
}

function createEngine(seed, answers = []) {
  let answerCursor = 0;

  function promptSignature(type, args) {
    const details = {
      type,
      player: args.player,
      kind: args.kind ?? null,
      id: args.id ?? null,
      min: args.min ?? null,
      max: Number.isFinite(args.max) ? args.max : null,
      options: args.options ?? null,
      uid: args.uid ?? null,
      effectId: args.effect?.id ?? null,
      event: args.event ?? null,
      loops: args.loops ?? null,
      chain: type === "respond" ? (args.chain ?? []).map((link) => ({
        kind: link.kind,
        uid: link.uid,
        eid: link.eid,
        player: link.player,
        negated: link.negated,
      })) : null,
    };
    return JSON.stringify(details);
  }

  function promptRecord(type, args) {
    return {
      type,
      player: args.player,
      kind: args.kind ?? null,
      id: args.id ?? null,
      min: Number.isFinite(args.min) ? args.min : null,
      max: Number.isFinite(args.max) ? args.max : null,
      options: args.options ?? null,
      uid: args.uid ?? null,
      effectId: args.effect?.id ?? null,
      loops: args.loops ?? null,
      signature: promptSignature(type, args),
    };
  }

  function ask(type, args) {
    const prompt = promptRecord(type, args);
    const answer = answers[answerCursor];
    if (!answer) throw new InputRequired(prompt);
    if (answer.type !== type || answer.signature !== prompt.signature) {
      throw new DuelRuleError("stale_choice", "선택 화면이 갱신됐습니다. 현재 선택을 다시 확인하세요.");
    }
    answerCursor += 1;

    if (type === "confirm" || type === "again") return answer.value;
    if (type === "respond") return answer.value === null ? null : args.options[answer.value];
    if (args.kind === "number") return answer.value;
    return answer.value.map((index) => args.options[index]);
  }

  return new Engine(CARD_DEFINITIONS, {
    seed,
    effectFilters: genericDeck.effect_filters,
    choose: (args) => ask("choose", args),
    confirm: (args) => ask("confirm", args),
    respond: (args) => ask("respond", args),
    again: (args) => ask("again", args),
  });
}

export function createDuel(decks = [defaultPlayerDeck(), defaultPlayerDeck()]) {
  const playerDecks = PLAYERS.map((_, seat) => validatePlayerDeck(decks[seat] ?? defaultPlayerDeck()));
  const seed = randomSeed();
  const engine = createEngine(seed);
  for (const [seat, player] of PLAYERS.entries()) {
    const deck = playerDecks[seat];
    for (const id of deck.main) engine.addCard(id, player, "deck");
    for (const id of deck.key) engine.addCard(id, player, "keydeck");
    engine.shuffle(player);
  }

  const firstPlayer = seed & 1 ? "A" : "B";
  for (const player of PLAYERS) {
    const openingHandSize = player === firstPlayer ? FIRST_OPENING_HAND_SIZE : SECOND_OPENING_HAND_SIZE;
    for (let count = 0; count < openingHandSize; count += 1) {
      const uid = engine.S.players[player].deck[0];
      if (uid) engine.moveCard(uid, "hand", { revealed: false });
    }
  }
  // The opening deal is not treated as a card effect or a draw event.
  engine.S.pending = [];
  engine.S.turn.number = 0;
  engine.startTurn(firstPlayer, { first: true });

  return {
    state: engine.state,
    rngState: engine.rngState,
    pending: null,
    winnerSeat: null,
    finished: false,
  };
}

function readChoice(prompt, body) {
  const values = Array.isArray(body.values) ? body.values : [];

  if (prompt.type === "confirm" || prompt.type === "again") {
    if (values.length !== 1 || !["yes", "no"].includes(values[0])) {
      throw new DuelRuleError("invalid_choice", "예 또는 아니요를 선택하세요.");
    }
    return { type: prompt.type, signature: prompt.signature, value: values[0] === "yes" };
  }

  if (prompt.type === "respond") {
    if (values.length !== 1) throw new DuelRuleError("invalid_choice", "응답을 하나 선택하세요.");
    if (values[0] === "pass") return { type: prompt.type, signature: prompt.signature, value: null };
    const index = Number(values[0]);
    if (!Number.isInteger(index) || index < 0 || index >= prompt.options.length) {
      throw new DuelRuleError("invalid_choice", "유효하지 않은 응답입니다.");
    }
    return { type: prompt.type, signature: prompt.signature, value: index };
  }

  if (prompt.kind === "number") {
    if (values.length !== 1) throw new DuelRuleError("invalid_choice", "숫자를 하나 선택하세요.");
    const value = Number(values[0]);
    if (!Number.isInteger(value) || value < prompt.min || value > prompt.max) {
      throw new DuelRuleError("invalid_choice", "선택한 숫자가 범위를 벗어났습니다.");
    }
    return { type: "choose", signature: prompt.signature, value };
  }

  const indexes = values.map(Number);
  const min = prompt.min ?? 1;
  const max = prompt.max ?? prompt.options.length;
  if (indexes.length < min || indexes.length > max || new Set(indexes).size !== indexes.length ||
      indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= prompt.options.length)) {
    throw new DuelRuleError("invalid_choice", `카드를 ${min}~${max}개 선택하세요.`);
  }
  return { type: "choose", signature: prompt.signature, value: indexes };
}

function requireActiveTurn(engine, seat, phase = null) {
  const state = engine.state;
  if (state.turn.player !== seatPlayer(seat)) {
    throw new DuelRuleError("not_your_turn", "상대 턴에는 이 행동을 할 수 없습니다.");
  }
  if (phase && state.turn.phase !== phase) {
    throw new DuelRuleError("wrong_phase", "현재 단계에서는 이 행동을 할 수 없습니다.");
  }
  if (state.chain.length > 0) {
    throw new DuelRuleError("chain_pending", "체인 처리가 끝난 뒤 행동할 수 있습니다.");
  }
}

function applyCommand(engine, game, seat, command) {
  const player = seatPlayer(seat);
  switch (command.type) {
    case "normal_summon":
      throw new DuelRuleError("invalid_action", "이 게임에는 일반 소환이 없습니다. 몬스터는 카드 효과나 키 카드 소환 절차로만 소환할 수 있습니다.");
    case "activate": {
      requireActiveTurn(engine, seat);
      const allowed = engine.activatableIgnitions(player).some((option) =>
        option.uid === command.uid && option.eid === command.effectId);
      if (!allowed) throw new DuelRuleError("invalid_effect", "지금 발동할 수 없는 효과입니다.");
      engine.activate(command.uid, command.effectId);
      return;
    }
    case "fetch": {
      requireActiveTurn(engine, seat);
      if (!engine.fetchOk(player, command.uid)) {
        throw new DuelRuleError("invalid_fetch", "이 키 카드는 지금 가져올 수 없습니다.");
      }
      engine.fetchKeyCard(player, command.uid);
      return;
    }
    case "key_summon": {
      requireActiveTurn(engine, seat, "deploy");
      if (!engine.canKeySummon(player, command.uid)) {
        throw new DuelRuleError("invalid_key_summon", "이 키 카드는 지금 소환할 수 없습니다.");
      }
      engine.keySummon(player, command.uid);
      return;
    }
    case "attack": {
      requireActiveTurn(engine, seat, "attack");
      const target = command.targetUid || null;
      if (!engine.canAttack(command.uid, target)) {
        throw new DuelRuleError("invalid_attack", "이 공격은 지금 선언할 수 없습니다.");
      }
      engine.declareAttack(command.uid, target);
      return;
    }
    case "next_phase": {
      requireActiveTurn(engine, seat);
      if (engine.state.turn.phase === "deploy") {
        engine.setPhase("attack");
      } else if (engine.state.turn.phase === "attack") {
        engine.setPhase("end");
      } else if (engine.state.turn.phase === "end") {
        const nextPlayer = OTHER(player);
        engine.startTurn(nextPlayer);
      } else {
        throw new DuelRuleError("wrong_phase", "다음 단계로 이동할 수 없습니다.");
      }
      return;
    }
    default:
      throw new DuelRuleError("invalid_action", "지원하지 않는 게임 행동입니다.");
  }
}

export function executeDuelCommand(game, seat, command) {
  if (![0, 1].includes(seat)) throw new DuelRuleError("invalid_seat", "플레이어 자리를 확인할 수 없습니다.");
  if (game.finished) throw new DuelRuleError("game_finished", "대전이 끝났습니다.");

  const pending = game.pending;
  let action = command;
  let initiatorSeat = seat;
  let answers = [];
  let baseState = game.state;
  let baseRngState = game.rngState;

  if (pending) {
    if (command.type !== "choice") throw new DuelRuleError("choice_pending", "먼저 진행 중인 선택을 완료하세요.");
    if (seatPlayer(seat) !== pending.prompt.player) {
      throw new DuelRuleError("not_prompted_player", "현재 선택을 요청받은 플레이어만 응답할 수 있습니다.");
    }
    action = pending.command;
    initiatorSeat = pending.initiatorSeat;
    answers = [...pending.answers, readChoice(pending.prompt, command)];
    baseState = pending.baseState;
    baseRngState = pending.baseRngState;
  } else if (command.type === "choice") {
    throw new DuelRuleError("no_pending_choice", "진행 중인 선택이 없습니다.");
  }

  const working = structuredClone(game);
  working.pending = null;
  const engine = createEngine(baseRngState, answers);
  engine.state = structuredClone(baseState);
  engine.rngState = baseRngState;

  try {
    applyCommand(engine, working, initiatorSeat, action);
  } catch (error) {
    if (!(error instanceof InputRequired)) throw error;
    working.state = structuredClone(baseState);
    working.rngState = baseRngState;
    working.pending = {
      command: structuredClone(action),
      initiatorSeat,
      answers,
      baseState: structuredClone(baseState),
      baseRngState,
      prompt: error.prompt,
    };
    return working;
  }

  working.state = engine.state;
  working.rngState = engine.rngState;
  working.pending = null;
  const emptyHands = PLAYERS.filter((player) => engine.state.players[player].hand.length === 0);
  if (emptyHands.length === 2) {
    working.finished = true;
    working.winnerSeat = -1;
  } else if (emptyHands.length === 1) {
    working.finished = true;
    working.winnerSeat = playerSeat(OTHER(emptyHands[0]));
  }
  return working;
}

function cardView(engine, uid, viewer) {
  const card = engine.state.cards[uid];
  const hidden = card.zone === "hand" && card.owner !== viewer && !card.revealed;
  if (hidden) return { hidden: true, revealed: false, id: null, name: null, uid: null, type: null, attack: null, bonus: 0 };
  const definition = engine.def(uid);
  return {
    uid,
    id: definition.id,
    name: engine.effectiveName(uid),
    type: definition.type,
    attack: definition.attack ?? null,
    bonus: card.bonus,
    currentAttack: definition.type === "monster" ? engine.attack(uid) : null,
    revealed: card.revealed,
    hidden: false,
  };
}

function cardLabel(engine, uid, viewer) {
  const card = engine.state.cards[uid];
  if (card.zone === "hand" && card.owner !== viewer && !card.revealed) return "비공개 카드";
  const definition = engine.def(uid);
  const attack = definition.type === "monster" ? ` · 공격력 ${engine.attack(uid)}` : "";
  return `${engine.effectiveName(uid)}${attack}`;
}

function choicePrompt(game, engine, viewerSeat) {
  const pending = game.pending;
  if (!pending) return null;
  const prompt = pending.prompt;
  const promptedSeat = playerSeat(prompt.player);
  const id = `${pending.answers.length}-${prompt.player}-${prompt.type}`;
  if (promptedSeat !== viewerSeat) {
    return { id, waiting: true, title: "상대의 선택을 기다리는 중", kind: "waiting", options: [] };
  }

  let title = "선택하세요";
  let options = [];
  let min = 1;
  let max = 1;
  if (prompt.type === "respond") {
    title = "체인에 응답할 효과를 선택하세요";
    options = prompt.options.map((option, index) => {
      if (option.fetch) {
        return { value: String(index), label: `${engine.def(option.uid).name} 가져오기` };
      }
      return { value: String(index), label: `${engine.def(option.uid).name} ${option.eid} 효과` };
    });
    options.push({ value: "pass", label: "패스" });
  } else if (prompt.type === "confirm" || prompt.type === "again") {
    title = prompt.type === "again" ? "효과를 한 번 더 처리할까요?" : "선택 효과를 발동할까요?";
    options = [{ value: "yes", label: "예" }, { value: "no", label: "아니요" }];
  } else if (prompt.kind === "number") {
    title = `숫자를 선택하세요 (${prompt.min}~${prompt.max})`;
    min = 1;
    max = 1;
    options = Array.from({ length: Math.max(0, prompt.max - prompt.min + 1) }, (_, index) => {
      const value = prompt.min + index;
      return { value: String(value), label: String(value) };
    });
  } else {
    min = prompt.min ?? 1;
    max = prompt.max ?? prompt.options.length;
    title = `카드를 선택하세요 (${min}~${max}개)`;
    options = prompt.options.map((value, index) => {
      const uids = Array.isArray(value) ? value : [value];
      return { value: String(index), label: uids.map((uid) => cardLabel(engine, uid, prompt.player)).join(" + ") };
    });
  }

  return { id, waiting: false, title, kind: prompt.type, inputKind: prompt.kind, min, max, options };
}

function availableActions(engine, game, seat) {
  if (game.finished || game.pending) return [];
  const player = seatPlayer(seat);
  if (engine.state.turn.player !== player) return [];
  const phase = engine.state.turn.phase;
  const actions = [];

  if (phase === "deploy") {
    for (const uid of engine.state.players[player].keydeck) {
      if (engine.canKeySummon(player, uid)) {
        actions.push({ type: "key_summon", uid, label: `${engine.def(uid).name} 키 소환` });
      }
    }
  }

  for (const option of engine.activatableIgnitions(player)) {
    actions.push({
      type: "activate",
      uid: option.uid,
      effectId: option.eid,
      label: `${engine.def(option.uid).name} ${option.eid} 발동`,
    });
  }

  for (const option of engine.fetchOptions(player)) {
    actions.push({ type: "fetch", uid: option.uid, label: `${engine.def(option.uid).name} 가져오기` });
  }

  if (phase === "attack") {
    for (const attacker of engine.state.players[player].field) {
      if (engine.canAttack(attacker, null)) {
        actions.push({ type: "attack", uid: attacker, targetUid: null, label: `${engine.def(attacker).name} 직접 공격` });
      }
      for (const target of engine.state.players[OTHER(player)].field) {
        if (engine.canAttack(attacker, target)) {
          actions.push({
            type: "attack",
            uid: attacker,
            targetUid: target,
            label: `${engine.def(attacker).name} → ${engine.def(target).name} 공격`,
          });
        }
      }
    }
  }

  actions.push({ type: "next_phase", uid: null, label: phaseLabel(phase) });
  return actions;
}

function phaseLabel(phase) {
  if (phase === "deploy") return "공격 단계로";
  if (phase === "attack") return "엔드 단계로";
  return "다음 턴으로";
}

export function duelSnapshot(game, viewerSeat) {
  const viewer = seatPlayer(viewerSeat);
  const engine = createEngine(game.rngState);
  engine.state = game.state;
  engine.rngState = game.rngState;

  const players = PLAYERS.map((player, seat) => {
    const zones = engine.state.players[player];
    return {
      seat,
      handCount: zones.hand.length,
      hand: zones.hand.map((uid) => cardView(engine, uid, viewer)),
      deckCount: zones.deck.length,
      grave: zones.grave.map((uid) => cardView(engine, uid, viewer)),
      banished: zones.banished.map((uid) => cardView(engine, uid, viewer)),
      field: zones.field.map((uid) => cardView(engine, uid, viewer)),
      fieldZone: zones.field_zone.map((uid) => cardView(engine, uid, viewer)),
      keyDeckCount: zones.keydeck.length,
      keyDeck: player === viewer ? zones.keydeck.map((uid) => cardView(engine, uid, viewer)) : [],
    };
  });

  return {
    turnSeat: playerSeat(engine.state.turn.player),
    phase: engine.state.turn.phase,
    turnNumber: engine.state.turn.number,
    players,
    actions: availableActions(engine, game, viewerSeat),
    pendingChoice: choicePrompt(game, engine, viewerSeat),
    winnerSeat: game.winnerSeat,
    finished: game.finished,
    format: "사용자 덱 대전",
  };
}
