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

function toVisibleCard(match, card) {
  if (!card || !card.uid) return card;
  const instance = match.game.state.cards[card.uid];
  const definition = instance && DEFINITIONS.get(instance.id);
  if (!definition) return card;
  const display = DISPLAY_DEFINITIONS.get(instance.id);
  return {
    ...card,
    id: definition.id,
    deck: definition.deck,
    description: display?.description || definition.description || "",
  };
}

function snapshotFor(match, seat) {
  const snapshot = duelSnapshot(match.game, seat);
  return {
    ...snapshot,
    revision: match.revision,
    players: snapshot.players.map((player) => ({
      ...player,
      hand: player.hand.map((card) => toVisibleCard(match, card)),
      grave: player.grave.map((card) => toVisibleCard(match, card)),
      banished: player.banished.map((card) => toVisibleCard(match, card)),
      field: player.field.map((card) => toVisibleCard(match, card)),
      fieldZone: player.fieldZone.map((card) => toVisibleCard(match, card)),
      keyDeck: player.keyDeck.map((card) => toVisibleCard(match, card)),
    })),
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
      aiActionCache: new Map(),
      aiToolSeen: false,
    };
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

    if (match.game.finished) {
      match.aiActionCache.clear();
      return { code: match.code, revision: match.revision, canAct: false, reason: "대전이 끝났습니다.", actions: [] };
    }

    if (isAiChoice(match)) {
      match.aiActionCache.clear();
      return {
        code: match.code,
        revision: match.revision,
        canAct: true,
        kind: "choice",
        choice: snapshot.pendingChoice,
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
    return { code: match.code, revision: match.revision, canAct: true, kind: "actions", actions };
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
      "승리: 상대 패를 0장으로 만든다.",
      "턴: 드로우 → 전개 → 공격 → 엔드. 선공 첫 턴은 드로우하지 않는다.",
      "일반 소환은 없다. 몬스터는 카드 효과 또는 키 카드 소환 절차로만 소환한다. 몬스터 존은 5칸이다.",
      "카드 효과와 키 카드 소환 절차는 서버 엔진이 검증한다. 도구가 제시한 합법 행동만 사용한다.",
      "AI는 플레이어 B다. 사람 패의 비공개 카드는 상태 응답에서 숨겨진다.",
      "같은 카드 최대 투입: 메인 덱 4장, 키 카드 덱 1장. 키 카드 덱 최대 10장.",
    ].join("\n");
  }

  #apply(code, seat, command) {
    const match = this.#match(code);
    match.lastActivityAt = this.now();
    return this.#applyMatch(match, seat, command);
  }

  #applyMatch(match, seat, command) {
    requireObject(command, "행동");
    try {
      match.game = executeDuelCommand(match.game, seat, clone(command));
    } catch (error) {
      if (error instanceof MatchError) throw error;
      throw new MatchError(error.code || "invalid_action", error.message || "행동을 처리하지 못했습니다.", 409);
    }
    match.revision += 1;
    match.aiActionCache.clear();
    return this.getState(match.code, seat);
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
