import { randomBytes } from "node:crypto";
import displayCatalog from "../../server/src/cards/card_catalog.json" with { type: "json" };
import {
  CARD_DEFINITIONS,
  createDuel,
  defaultPlayerDeck,
  duelSnapshot,
  executeDuelCommand,
  validatePlayerDeck,
} from "../../server/src/duel.js";
import { normalizeDeckFile } from "./deck-format.mjs";

const DEFINITIONS = new Map(CARD_DEFINITIONS.map((card) => [card.id, card]));
const DISPLAY_DEFINITIONS = new Map(displayCatalog.cards.map((card) => [card.id, card]));
const HUMAN_SEAT = 0;
const AI_SEAT = 1;
const GAME_TTL_MS = 6 * 60 * 60 * 1000;
const GAME_LIMIT = 500;
const EVENT_LOG_LIMIT = 100;
const SNAPSHOT_EVENT_LIMIT = 12;

export class MatchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MatchError";
    this.code = code;
    this.status = status;
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MatchError("invalid_input", label + " 형식을 확인하세요.");
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function toVisibleCard(match, card, { includeDescription = false } = {}) {
  if (!card || !card.uid) return card;
  const instance = match.game.state.cards[card.uid];
  const definition = instance && DEFINITIONS.get(instance.id);
  if (!definition) return card;
  return {
    ...card,
    id: definition.id,
    deck: definition.deck,
    ...(includeDescription ? {
      description: DISPLAY_DEFINITIONS.get(instance.id)?.description || definition.description || "",
    } : {}),
  };
}

function snapshotFor(match, seat, { includeDescriptions = seat === HUMAN_SEAT } = {}) {
  const snapshot = duelSnapshot(match.game, seat);
  const pendingEvents = (match.game.pending?.previewLog || []).slice(-SNAPSHOT_EVENT_LIMIT).map((text, index) => ({
    id: null,
    revision: match.revision,
    pending: true,
    text,
    previewIndex: index,
  }));
  return {
    ...snapshot,
    revision: match.revision,
    recentEvents: [...match.eventLog.slice(-SNAPSHOT_EVENT_LIMIT), ...pendingEvents].slice(-SNAPSHOT_EVENT_LIMIT),
    eventCursor: match.eventSeq,
    players: snapshot.players.map((player) => ({
      ...player,
      hand: player.hand.map((card) => toVisibleCard(match, card, { includeDescription: includeDescriptions })),
      grave: player.grave.map((card) => toVisibleCard(match, card, { includeDescription: includeDescriptions })),
      banished: player.banished.map((card) => toVisibleCard(match, card, { includeDescription: includeDescriptions })),
      field: player.field.map((card) => toVisibleCard(match, card, { includeDescription: includeDescriptions })),
      fieldZone: player.fieldZone.map((card) => toVisibleCard(match, card, { includeDescription: includeDescriptions })),
      keyDeck: player.keyDeck.map((card) => toVisibleCard(match, card, { includeDescription: includeDescriptions })),
    })),
  };
}

function zoneCount(player, zone) {
  if (zone === "deck") return player.deckCount;
  if (zone === "keyDeck") return player.keyDeckCount;
  if (zone === "hand") return player.handCount;
  return player[zone]?.length ?? 0;
}

function zoneCards(player, zone) {
  if (zone === "deck") return [];
  return player[zone] || [];
}

function stateDelta(before, after) {
  const zones = ["hand", "deck", "grave", "banished", "field", "fieldZone", "keyDeck"];
  const changedZones = [];
  for (let index = 0; index < after.players.length; index += 1) {
    const beforePlayer = before.players[index];
    const afterPlayer = after.players[index];
    for (const zone of zones) {
      const beforeCards = zoneCards(beforePlayer, zone);
      const afterCards = zoneCards(afterPlayer, zone);
      const beforeIds = new Set(beforeCards.map((card) => card.uid).filter(Boolean));
      const afterIds = new Set(afterCards.map((card) => card.uid).filter(Boolean));
      const added = afterCards.filter((card) => card.uid && !beforeIds.has(card.uid));
      const removed = beforeCards.filter((card) => card.uid && !afterIds.has(card.uid));
      const beforeCount = zoneCount(beforePlayer, zone);
      const afterCount = zoneCount(afterPlayer, zone);
      if (beforeCount !== afterCount || added.length || removed.length) {
        changedZones.push({ seat: afterPlayer.seat, zone, beforeCount, afterCount, added, removed });
      }
    }
  }
  return {
    fromRevision: before.revision,
    revision: after.revision,
    turnSeat: after.turnSeat,
    turnPlayer: after.turnPlayer,
    phase: after.phase,
    turnNumber: after.turnNumber,
    finished: after.finished,
    winnerSeat: after.winnerSeat,
    changedZones,
    chain: after.chain,
    pendingChoice: after.pendingChoice,
    recentEvents: after.recentEvents.filter((event) => event.pending || event.revision === after.revision),
    eventCursor: after.eventCursor,
  };
}

function cardCatalog() {
  return CARD_DEFINITIONS.map(({ id, name, type, deck, attack, description }) => ({
    id,
    name: DISPLAY_DEFINITIONS.get(id)?.name || name,
    type: DISPLAY_DEFINITIONS.get(id)?.type || type,
    deck,
    attack: attack ?? DISPLAY_DEFINITIONS.get(id)?.attack ?? null,
    description: DISPLAY_DEFINITIONS.get(id)?.description || description || "",
  }));
}

function isAiChoice(match) {
  return Boolean(match.game.pending && match.game.pending.prompt.player === "B");
}

export class MatchStore {
  constructor({ duelFactory = createDuel, now = () => Date.now() } = {}) {
    this.games = new Map();
    this.duelFactory = duelFactory;
    this.now = now;
  }

  create({ humanDeck, aiDeck, aiName } = {}) {
    if (aiDeck === undefined || aiDeck === null) {
      throw new MatchError("ai_deck_required", "앱의 AI 덱 편집창에서 AI 덱을 먼저 만들고 저장하세요.");
    }
    this.#prune();
    const playerDeck = validatePlayerDeck(normalizeDeckFile(humanDeck ?? defaultPlayerDeck()));
    const opponentDeckInput = normalizeDeckFile(aiDeck);
    const opponentDeck = validatePlayerDeck(opponentDeckInput);
    const game = this.duelFactory([playerDeck, opponentDeck]);
    const code = randomBytes(16).toString("hex").toUpperCase();
    const match = {
      code,
      game,
      aiName: typeof aiName === "string" && aiName.trim()
        ? aiName.trim().slice(0, 40)
        : opponentDeckInput.name.slice(0, 40),
      createdAt: this.now(),
      lastActivityAt: this.now(),
      revision: 0,
      eventSeq: 0,
      eventLog: [],
      waiters: new Set(),
      lastDelta: null,
      aiActionCache: new Map(),
      aiToolSeen: false,
    };
    this.#appendEvents(match, game.pending ? [] : (game.initialLog || []), 0);
    this.games.set(code, match);
    while (this.games.size > GAME_LIMIT) this.games.delete(this.games.keys().next().value);
    return this.getState(code, HUMAN_SEAT);
  }

  getState(code, seat = HUMAN_SEAT) {
    const match = this.#match(code);
    if (![HUMAN_SEAT, AI_SEAT].includes(seat)) throw new MatchError("invalid_seat", "플레이어 자리를 확인하세요.");
    match.lastActivityAt = this.now();
    if (seat === AI_SEAT) match.aiToolSeen = true;
    return {
      code: match.code,
      aiToolSeen: match.aiToolSeen,
      aiName: match.aiName,
      revision: match.revision,
      snapshot: snapshotFor(match, seat),
    };
  }

  getLegalActions(code) {
    const match = this.#match(code);
    match.lastActivityAt = this.now();
    match.aiToolSeen = true;
    const snapshot = snapshotFor(match, AI_SEAT);

    const context = {
      turnSeat: snapshot.turnSeat,
      turnPlayer: snapshot.turnPlayer,
      phase: snapshot.phase,
      turnNumber: snapshot.turnNumber,
      chain: snapshot.chain,
      pendingChoice: snapshot.pendingChoice,
      recentEvents: snapshot.recentEvents,
      eventCursor: snapshot.eventCursor,
    };

    if (match.game.finished) {
      match.aiActionCache.clear();
      return { code: match.code, revision: match.revision, canAct: false, reason: "대전이 끝났습니다.", ...context, actions: [] };
    }

    if (isAiChoice(match)) {
      match.aiActionCache.clear();
      return {
        code: match.code,
        revision: match.revision,
        canAct: true,
        kind: "choice",
        choice: snapshot.pendingChoice,
        ...context,
        actions: [],
      };
    }

    if (match.game.pending || match.game.state.turn.player !== "B") {
      match.aiActionCache.clear();
      return {
        code: match.code,
        revision: match.revision,
        canAct: false,
        reason: match.game.pending ? "사람 플레이어의 선택 또는 응답을 기다리고 있습니다." : "사람 플레이어 차례입니다.",
        ...context,
        actions: [],
      };
    }

    const actions = snapshot.actions.map((action, index) => {
      const actionId = "r" + match.revision + "-a" + index;
      const command = { ...action };
      delete command.label;
      match.aiActionCache.set(actionId, { revision: match.revision, command });
      return { actionId, label: action.label, command };
    });
    return { code: match.code, revision: match.revision, canAct: true, kind: "actions", ...context, actions };
  }

  getRecentEvents(code, { afterEventId = 0, limit = 20 } = {}) {
    const match = this.#match(code);
    match.lastActivityAt = this.now();
    match.aiToolSeen = true;
    if (!Number.isInteger(afterEventId) || afterEventId < 0) throw new MatchError("invalid_input", "after_event_id는 0 이상의 정수여야 합니다.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new MatchError("invalid_input", "limit은 1~50 사이의 정수여야 합니다.");
    const events = match.eventLog.filter((event) => event.id > afterEventId).slice(-limit);
    return {
      code: match.code,
      revision: match.revision,
      events,
      pendingEvents: (match.game.pending?.previewLog || []).slice(-limit).map((text) => ({ revision: match.revision, text })),
      eventCursor: match.eventSeq,
      oldestEventId: match.eventLog[0]?.id ?? match.eventSeq + 1,
    };
  }

  getLatestDelta(code) {
    const match = this.#match(code);
    return match.lastDelta ? clone(match.lastDelta) : null;
  }

  waitForAction(code, { timeoutSeconds = 30 } = {}) {
    const match = this.#match(code);
    match.lastActivityAt = this.now();
    match.aiToolSeen = true;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 30) {
      throw new MatchError("invalid_input", "timeout_seconds는 1~30 사이의 정수여야 합니다.");
    }
    if (this.#aiCanAct(match) || match.game.finished) return Promise.resolve(this.#waitResult(match, false));
    if (match.waiters.size >= 50) throw new MatchError("too_many_waiters", "이 대전의 대기 요청이 너무 많습니다.", 429);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (timedOut) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        match.waiters.delete(checkReady);
        match.lastActivityAt = this.now();
        resolve(this.#waitResult(match, timedOut));
      };
      const checkReady = () => {
        if (this.#aiCanAct(match) || match.game.finished) finish(false);
      };
      const timer = setTimeout(() => finish(true), timeoutSeconds * 1000);
      match.waiters.add(checkReady);
    });
  }

  applyHumanCommand(code, command) {
    return this.#apply(code, HUMAN_SEAT, command);
  }

  applyAiAction(code, { actionId, choiceValues } = {}) {
    const match = this.#match(code);
    match.lastActivityAt = this.now();
    match.aiToolSeen = true;
    let command;

    if (match.game.pending) {
      if (!isAiChoice(match)) {
        throw new MatchError("not_ai_choice", "현재 선택은 사람 플레이어가 처리해야 합니다.", 409);
      }
      if (!Array.isArray(choiceValues) || choiceValues.length === 0 || choiceValues.some((value) => typeof value !== "string")) {
        throw new MatchError("invalid_choice", "선택값(choice_values) 목록을 전달하세요.");
      }
      command = { type: "choice", values: [...choiceValues] };
    } else {
      if (match.game.state.turn.player !== "B") {
        throw new MatchError("not_ai_turn", "현재 사람 플레이어 차례입니다.", 409);
      }
      const cached = match.aiActionCache.get(actionId);
      if (!cached || cached.revision !== match.revision) {
        throw new MatchError("stale_action", "행동 목록이 갱신됐습니다. 합법 행동을 다시 불러오세요.", 409);
      }
      command = cached.command;
    }

    return this.#applyMatch(match, AI_SEAT, command);
  }

  getCatalog() {
    return cardCatalog();
  }

  getRules() {
    return [
      "승리 조건: 상대의 패를 0장으로 만든다. 두 플레이어의 패가 동시에 0장이면 무승부다.",
      "자리: 사람은 A, AI는 B다. 선공은 시작 패 6장, 후공은 7장으로 시작한다. 선공 첫 턴에는 드로우하지 않는다.",
      "턴 순서: 드로우 → 전개 → 공격 → 엔드. 전개에서 공격으로, 공격에서 엔드로, 엔드에서 상대 턴으로 넘어간다.",
      "일반 소환은 없다. 몬스터는 효과 처리 또는 키 카드 소환 절차로만 소환한다. 플레이어마다 몬스터 존 5칸과 필드 존 1칸이 있다.",
      "우선권과 체인: 효과나 필드 카드 발동은 체인 링크를 만든다. 새 링크가 놓이면 마지막 링크를 발동한 플레이어의 상대가 먼저 응답한다. 양쪽이 연속으로 패스하면 체인을 마지막 링크부터 역순으로 처리한다.",
      "체인 처리로 유발 효과가 생기면 새 체인으로 올린다. 유발 효과는 턴 플레이어부터 올린다. 체인이 끝난 뒤와 드로우·단계 경계 같은 퀵타이밍 창에도 합법적인 빠른 효과를 발동할 수 있다.",
      "효과는 코스트를 먼저 지불하고 체인에 올린다. 체인 해결 전에는 효과 처리 결과가 아직 필드에 반영되지 않을 수 있다. 무효가 되어도 이미 지불한 코스트는 돌아오지 않는다.",
      "패 공개: 일반 드로우는 비공개다. 카드 효과로 공개 서치하거나 키 카드 가져오기로 패에 넣은 카드는 공개 상태로 들어간다. 상태 응답은 상대의 비공개 패 카드 ID와 이름을 숨긴다.",
      "필드 카드: 발동하면 필드 존에 놓인다. 같은 플레이어가 새 필드 카드를 발동하면 기존 필드 카드는 묘지로 간다.",
      "키 카드: 키 카드 덱은 최대 10장, 같은 키 카드는 1장만 넣는다. 키 카드 가져오기는 체인에 올라가며 체인당 1장만 선언할 수 있다. 카드 데이터에 fetch.forbidden이 있으면 가져올 수 없다.",
      "카드 데이터의 효과 제한을 따른다. 같은 효과의 1턴 1회 제한과 카드명 단위 제한은 지정된 제한 그룹을 공유한다.",
      "메인 덱은 40~60장, 같은 카드는 최대 4장이다. 효과와 키 카드 절차의 실행 가능 여부는 서버 엔진이 검증한다. get_legal_actions의 행동만 사용한다.",
      "상태에서 chain은 현재 체인 링크를, pendingChoice는 지금 답해야 하는 선택을, recentEvents는 최근 처리 내역을 보여준다. duel_action은 전체 상태 대신 변경분을 반환한다. 상태의 카드 ID로 get_card_catalog에서 효과 문장을 확인한다.",
    ].join("\n");
  }

  #apply(code, seat, command) {
    const match = this.#match(code);
    match.lastActivityAt = this.now();
    return this.#applyMatch(match, seat, command);
  }

  #applyMatch(match, seat, command) {
    requireObject(command, "행동");
    const before = snapshotFor(match, AI_SEAT);
    const nextRevision = match.revision + 1;
    let nextGame;
    try {
      nextGame = executeDuelCommand(match.game, seat, clone(command));
    } catch (error) {
      if (error instanceof MatchError) throw error;
      throw new MatchError(error.code || "invalid_action", error.message || "행동을 처리하지 못했습니다.", 409);
    }
    match.game = nextGame;
    match.revision = nextRevision;
    if (!nextGame.pending) this.#appendEvents(match, nextGame.lastActionLog || [], nextRevision);
    match.aiActionCache.clear();
    const after = snapshotFor(match, AI_SEAT);
    match.lastDelta = stateDelta(before, after);
    for (const wake of [...match.waiters]) wake();
    return this.getState(match.code, seat);
  }

  #appendEvents(match, messages, revision) {
    for (const text of messages) {
      if (typeof text !== "string" || !text.trim()) continue;
      match.eventLog.push({ id: ++match.eventSeq, revision, text });
    }
    if (match.eventLog.length > EVENT_LOG_LIMIT) match.eventLog.splice(0, match.eventLog.length - EVENT_LOG_LIMIT);
  }

  #aiCanAct(match) {
    return isAiChoice(match) || (!match.game.pending && match.game.state.turn.player === "B");
  }

  #waitResult(match, timedOut) {
    const snapshot = snapshotFor(match, AI_SEAT);
    const canAct = this.#aiCanAct(match);
    return {
      code: match.code,
      revision: match.revision,
      ready: canAct || match.game.finished,
      timedOut,
      canAct,
      reason: match.game.finished
        ? "대전이 끝났습니다."
        : canAct
          ? "AI가 행동하거나 선택에 응답할 수 있습니다."
          : "사람 플레이어의 차례 또는 선택을 기다리고 있습니다.",
      turnSeat: snapshot.turnSeat,
      turnPlayer: snapshot.turnPlayer,
      phase: snapshot.phase,
      chain: snapshot.chain,
      pendingChoice: snapshot.pendingChoice,
      recentEvents: snapshot.recentEvents,
      eventCursor: snapshot.eventCursor,
    };
  }

  #match(code) {
    if (typeof code !== "string" || !/^[A-F0-9]{32}$/.test(code)) {
      throw new MatchError("invalid_game_code", "대전 코드를 확인하세요.", 404);
    }
    const match = this.games.get(code);
    if (!match) throw new MatchError("game_not_found", "대전을 찾을 수 없거나 만료됐습니다.", 404);
    if (this.now() - match.lastActivityAt > GAME_TTL_MS) {
      this.games.delete(code);
      throw new MatchError("game_expired", "대전이 만료됐습니다. 새 대전을 시작하세요.", 410);
    }
    return match;
  }

  #prune() {
    const now = this.now();
    for (const [code, match] of this.games) {
      if (now - match.lastActivityAt > GAME_TTL_MS) this.games.delete(code);
    }
  }
}
