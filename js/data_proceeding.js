import { cards } from "./card_data.js";

// HAND BATTLE — data driven effect engine
// card_data.js에는 선언형 데이터만 두고, 이 파일은 그 데이터를 해석한다.
// UI/네트워크는 chooseCards / chooseYesNo / chooseRepeat 훅을 주입해 연결한다.

export const ZONES = Object.freeze({
  DECK: "DECK",
  HAND: "HAND",
  PUBLIC_HAND: "PUBLIC_HAND",
  FIELD: "FIELD",
  GRAVE: "GRAVE",
  EXILE: "EXILE",
  KEY_DECK: "KEY_DECK",
});

export const EFFECT_TYPES = Object.freeze({
  ACTIVATED: "ACTIVATED",
  QUICK: "QUICK",
  TRIGGER: "TRIGGER",
  CONTINUOUS: "CONTINUOUS",
  REPLACEMENT: "REPLACEMENT",
});

const ALL_ZONES = Object.freeze(Object.values(ZONES));
const HAND_ZONES = Object.freeze([ZONES.HAND, ZONES.PUBLIC_HAND]);

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(items) {
  return [...new Set(items)];
}

function clampInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : min;
  return Math.min(max, Math.max(min, number));
}

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function defaultChooseCards(candidates, request) {
  const max = Math.min(request.max, candidates.length);
  return candidates.slice(0, max);
}

async function defaultChooseYesNo() {
  return true;
}

async function defaultChooseRepeat() {
  return false;
}

export function createEmptyPlayerState() {
  return {
    zones: {
      [ZONES.DECK]: [],
      [ZONES.HAND]: [],
      [ZONES.PUBLIC_HAND]: [],
      [ZONES.FIELD]: [],
      [ZONES.GRAVE]: [],
      [ZONES.EXILE]: [],
      [ZONES.KEY_DECK]: [],
    },
  };
}

export function createEmptyGameState(playerIds = ["P1", "P2"], options = {}) {
  if (!Array.isArray(playerIds) || playerIds.length !== 2) {
    throw new Error("HAND BATTLE 엔진의 현재 버전은 정확히 2명의 플레이어를 필요로 합니다.");
  }

  const players = Object.fromEntries(playerIds.map((id) => [id, createEmptyPlayerState()]));
  return {
    players,
    turn: {
      number: 1,
      activePlayer: options.firstPlayer || playerIds[0],
      phase: options.phase || "DEPLOY",
    },
    rules: {
      monsterZoneCount: options.monsterZoneCount ?? 5,
    },
    chain: [],
    pendingEvents: [],
    eventHistory: [],
    effectUsage: {},
    nextInstanceNumber: 1,
    nextChainNumber: 1,
    nextEventNumber: 1,
    log: [],
  };
}

export function createCardInstance(cardId, options = {}) {
  const definition = cards[cardId];
  if (!definition) throw new Error(`알 수 없는 카드 ID입니다: ${cardId}`);
  const owner = options.owner;
  if (!owner) throw new Error("카드 인스턴스를 만들 때 owner가 필요합니다.");

  return {
    instanceId: options.instanceId || null,
    cardId,
    owner,
    controller: options.controller || owner,
    zone: options.zone || null,
    statChanges: [],
    flags: {},
  };
}

export class HandBattleEngine {
  constructor(options = {}) {
    this.cards = options.cards || cards;
    this.chooseCards = options.chooseCards || defaultChooseCards;
    this.chooseYesNo = options.chooseYesNo || defaultChooseYesNo;
    this.chooseRepeat = options.chooseRepeat || defaultChooseRepeat;
    this.onEvent = options.onEvent || (() => {});
    this.random = options.random || Math.random;
  }

  ensureState(state) {
    if (!state || !state.players) throw new Error("유효한 game state가 필요합니다.");
    state.chain ||= [];
    state.pendingEvents ||= [];
    state.eventHistory ||= [];
    state.effectUsage ||= {};
    state.log ||= [];
    state.nextInstanceNumber ||= 1;
    state.nextChainNumber ||= 1;
    state.nextEventNumber ||= 1;
    state.rules ||= { monsterZoneCount: 5 };
    return state;
  }

  getPlayerIds(state) {
    return Object.keys(this.ensureState(state).players);
  }

  opponentOf(state, playerId) {
    const opponent = this.getPlayerIds(state).find((id) => id !== playerId);
    if (!opponent) throw new Error(`상대 플레이어를 찾을 수 없습니다: ${playerId}`);
    return opponent;
  }

  resolveController(state, relative, selfController) {
    if (!relative || relative === "SELF") return [selfController];
    if (relative === "OPPONENT") return [this.opponentOf(state, selfController)];
    if (relative === "EITHER") return this.getPlayerIds(state);
    if (state.players[relative]) return [relative];
    throw new Error(`알 수 없는 controller 지정입니다: ${relative}`);
  }

  getZone(state, playerId, zone) {
    const player = this.ensureState(state).players[playerId];
    if (!player) throw new Error(`알 수 없는 플레이어입니다: ${playerId}`);
    const result = player.zones?.[zone];
    if (!Array.isArray(result)) throw new Error(`알 수 없는 존입니다: ${zone}`);
    return result;
  }

  addCardToZone(state, playerId, zone, cardId, options = {}) {
    this.ensureState(state);
    const instance = createCardInstance(cardId, {
      owner: options.owner || playerId,
      controller: options.controller || playerId,
      zone,
      instanceId: options.instanceId || `C${state.nextInstanceNumber++}`,
    });
    this.getZone(state, playerId, zone).push(instance);
    return instance;
  }

  seedZone(state, playerId, zone, cardIds) {
    return cardIds.map((cardId) => this.addCardToZone(state, playerId, zone, cardId));
  }

  getCardDefinition(cardOrId) {
    const cardId = typeof cardOrId === "string" ? cardOrId : cardOrId?.cardId;
    return cardId ? this.cards[cardId] || null : null;
  }

  findCardLocation(state, cardOrInstanceId) {
    const instanceId = typeof cardOrInstanceId === "string"
      ? cardOrInstanceId
      : cardOrInstanceId?.instanceId;
    if (!instanceId) return null;

    for (const playerId of this.getPlayerIds(state)) {
      for (const zone of ALL_ZONES) {
        const zoneCards = this.getZone(state, playerId, zone);
        const index = zoneCards.findIndex((card) => card.instanceId === instanceId);
        if (index !== -1) return { playerId, zone, index, card: zoneCards[index] };
      }
    }
    return null;
  }

  allInstances(state) {
    const result = [];
    for (const playerId of this.getPlayerIds(state)) {
      for (const zone of ALL_ZONES) result.push(...this.getZone(state, playerId, zone));
    }
    return result;
  }

  getEffectiveName(state, card) {
    const definition = this.getCardDefinition(card);
    if (!definition) return "";
    const rule = (definition.nonEffectText || []).find((entry) => {
      if (entry.type !== "TREAT_NAME_AS") return false;
      return !entry.zones || entry.zones.includes(card.zone);
    });
    return rule?.name || definition.name;
  }

  getEffectiveThemes(state, card) {
    const definition = this.getCardDefinition(card);
    if (!definition) return [];
    const themes = asArray(definition.theme).filter(Boolean);
    for (const rule of definition.nonEffectText || []) {
      if (rule.type === "TREAT_AS_THEME" && (!rule.zones || rule.zones.includes(card.zone))) {
        themes.push(rule.theme);
      }
    }
    return unique(themes);
  }

  getStat(state, card, stat) {
    const definition = this.getCardDefinition(card);
    const key = String(stat || "").toUpperCase();
    if (key !== "ATK") throw new Error(`아직 지원하지 않는 능력치입니다: ${stat}`);
    const base = Number(definition?.atk || 0);
    const delta = (card.statChanges || []).reduce((sum, change) => sum + Number(change.amount || 0), 0);
    return base + delta;
  }

  makeContext(state, options = {}) {
    const sourceCard = options.sourceCard || null;
    const controller = options.controller || sourceCard?.controller || null;
    return {
      state,
      controller,
      sourceCard,
      sourceCardId: sourceCard?.cardId || options.sourceCardId || null,
      effect: options.effect || null,
      effectId: options.effect?.id ?? options.effectId ?? null,
      effectType: options.effect?.type || options.effectType || null,
      reason: options.reason || "EFFECT",
      cause: options.cause || null,
      triggerEvent: options.triggerEvent || null,
      triggeringEffectLinkId: options.triggeringEffectLinkId || options.triggerEvent?.effectLinkId || null,
      targets: options.targets || {},
      activationTargetInstanceIds: options.activationTargetInstanceIds || new Set(),
      results: options.results || {},
      chainLink: options.chainLink || null,
    };
  }

  normalizeCount(countSpec, ctx, fallback = { min: 1, max: 1 }) {
    if (countSpec == null) return { ...fallback };
    if (typeof countSpec === "number") {
      const value = Math.max(0, Math.trunc(countSpec));
      return { min: value, max: value };
    }
    if (typeof countSpec !== "object") return { ...fallback };
    const min = Math.max(0, Math.trunc(this.evaluateExpression(countSpec.min ?? fallback.min, ctx)));
    const maxValue = countSpec.max === "UNBOUNDED"
      ? Number.MAX_SAFE_INTEGER
      : this.evaluateExpression(countSpec.max ?? fallback.max, ctx);
    const max = Math.max(min, Math.trunc(maxValue));
    return { min, max };
  }

  evaluateExpression(expression, ctx) {
    if (expression == null) return 0;
    if (typeof expression === "number") return expression;
    if (typeof expression === "string") {
      const number = Number(expression);
      return Number.isFinite(number) ? number : 0;
    }

    switch (expression.type) {
      case "RESULT_COUNT": {
        const value = ctx.results?.[expression.ref];
        if (Array.isArray(value)) return value.length;
        if (typeof value === "number") return value;
        return 0;
      }
      case "STAT": {
        const cardsForRef = asArray(ctx.targets?.[expression.targetRef]).filter(Boolean);
        const target = cardsForRef[0] || null;
        return target ? this.getStat(ctx.state, target, expression.stat) : 0;
      }
      case "DIVIDE": {
        const left = this.evaluateExpression(expression.left, ctx);
        const right = this.evaluateExpression(expression.right, ctx);
        return right === 0 ? 0 : left / right;
      }
      case "MULTIPLY":
        return asArray(expression.values).reduce((result, item) => result * this.evaluateExpression(item, ctx), 1);
      case "ADD":
        return asArray(expression.values).reduce((result, item) => result + this.evaluateExpression(item, ctx), 0);
      case "CEIL":
        return Math.ceil(this.evaluateExpression(expression.value, ctx));
      case "FLOOR":
        return Math.floor(this.evaluateExpression(expression.value, ctx));
      case "COUNT":
        return this.getCandidates(ctx.state, expression.selector || {}, ctx).length;
      default:
        throw new Error(`지원하지 않는 수식 타입입니다: ${expression.type}`);
    }
  }

  matchesCardFilter(state, card, filter = {}, ctx = {}) {
    const definition = this.getCardDefinition(card);
    if (!definition) return false;

    if (filter.card === "SELF_CARD" && card.instanceId !== ctx.sourceCard?.instanceId) return false;
    if (filter.cardId && card.cardId !== filter.cardId) return false;
    if (filter.cardType && definition.cardType !== filter.cardType) return false;
    if (filter.theme && !this.getEffectiveThemes(state, card).includes(filter.theme)) return false;
    if (filter.name) {
      const actualName = filter.nameMatch === "EFFECTIVE"
        ? this.getEffectiveName(state, card)
        : definition.name;
      if (actualName !== filter.name) return false;
    }

    if (filter.owner && filter.owner !== "EITHER") {
      const owners = this.resolveController(state, filter.owner, ctx.controller);
      if (!owners.includes(card.owner)) return false;
    }

    if (filter.controller && filter.controller !== "EITHER") {
      const controllers = this.resolveController(state, filter.controller, ctx.controller);
      if (!controllers.includes(card.controller)) return false;
    }

    if (filter.exclude === "SELF_CARD" && card.instanceId === ctx.sourceCard?.instanceId) return false;
    return true;
  }

  getCandidates(state, selector = {}, ctx, fromOverride = null) {
    if (selector.card === "SELF_CARD") {
      return ctx.sourceCard && this.findCardLocation(state, ctx.sourceCard) ? [ctx.sourceCard] : [];
    }

    const zones = unique(asArray(selector.zones || fromOverride || ALL_ZONES));
    const controllerSpec = selector.controller || "SELF";
    const zoneOwners = controllerSpec === "EITHER"
      ? this.getPlayerIds(state)
      : this.resolveController(state, controllerSpec, ctx.controller);

    const candidates = [];
    for (const playerId of zoneOwners) {
      for (const zone of zones) {
        for (const card of this.getZone(state, playerId, zone)) {
          if (this.matchesCardFilter(state, card, selector, ctx)) candidates.push(card);
        }
      }
    }
    return candidates;
  }

  async selectCards(state, selector = {}, ctx, options = {}) {
    let candidates = this.getCandidates(state, selector, ctx, options.from);
    if (options.requireAddToPublicHand) {
      candidates = candidates.filter((card) => this.canAddToPublicHand(state, card, ctx));
    }
    if (options.requireSummon) {
      candidates = candidates.filter((card) => this.canSummonCard(state, card, ctx, options.summonController || ctx.controller));
    }
    if (options.applyImmunity) {
      candidates = candidates.filter((card) => this.canReceiveEffect(state, card, ctx));
    }

    if (selector.selection === "ALL") return candidates;

    const { min, max } = this.normalizeCount(selector.count, ctx, { min: 1, max: 1 });
    if (selector.card === "SELF_CARD") return candidates.slice(0, Math.min(max, candidates.length));
    const boundedMax = Math.min(max, candidates.length);
    if (candidates.length < min) return [];

    const selectedRaw = await this.chooseCards(candidates.slice(), {
      min,
      max: boundedMax,
      controller: options.choosingPlayer || ctx.controller,
      prompt: options.prompt || "카드를 선택하세요.",
      context: ctx,
      selector,
    });

    const selectedIds = asArray(selectedRaw).map((item) => typeof item === "string" ? item : item?.instanceId);
    const selected = unique(selectedIds)
      .map((id) => candidates.find((card) => card.instanceId === id))
      .filter(Boolean)
      .slice(0, boundedMax);

    if (selected.length < min) return [];
    return selected;
  }

  checkCondition(state, condition, ctx) {
    if (!condition) return true;
    switch (condition.type) {
      case "EXISTS":
        return this.getCandidates(state, condition.selector || {}, ctx).length > 0;
      case "NOT_EXISTS":
        return this.getCandidates(state, condition.selector || {}, ctx).length === 0;
      case "AND":
        return asArray(condition.conditions).every((item) => this.checkCondition(state, item, ctx));
      case "OR":
        return asArray(condition.conditions).some((item) => this.checkCondition(state, item, ctx));
      case "NOT":
        return !this.checkCondition(state, condition.condition, ctx);
      case "SOURCE_EFFECT_DOES_NOT_TARGET": {
        const instanceId = condition.target === "SELF_CARD" ? ctx.sourceCard?.instanceId : null;
        return instanceId ? !ctx.activationTargetInstanceIds?.has(instanceId) : true;
      }
      default:
        throw new Error(`지원하지 않는 조건 타입입니다: ${condition.type}`);
    }
  }

  checkTiming(state, timing, controller) {
    if (!timing) return true;
    const { turn } = this.ensureState(state);
    if (timing.phase && turn.phase !== timing.phase) return false;
    if (!timing.turn || timing.turn === "EITHER") return true;
    if (timing.turn === "SELF") return turn.activePlayer === controller;
    if (timing.turn === "OPPONENT") return turn.activePlayer === this.opponentOf(state, controller);
    return turn.activePlayer === timing.turn;
  }

  getDefaultSourceZones(definition, effect) {
    if (effect.sourceZone) return asArray(effect.sourceZone);
    if (effect.type === EFFECT_TYPES.REPLACEMENT) return null;
    if (effect.type === EFFECT_TYPES.CONTINUOUS) return [ZONES.FIELD];

    // 트리거 효과는 사건의 발생 위치와 효과 본체가 존재해야 하는 위치를 구분한다.
    if (effect.type === EFFECT_TYPES.TRIGGER) {
      if (effect.event?.target === "SELF_CARD") {
        if (effect.event.type === "SUMMONED") return [ZONES.FIELD];
        if (effect.event.type === "SENT_TO_GRAVE") return [ZONES.GRAVE];
        if (effect.event.type === "BANISHED") return [ZONES.EXILE];
        if (effect.event.type === "ADDED_TO_PUBLIC_HAND") return [ZONES.PUBLIC_HAND];
      }
      if (definition.cardType === "monster") return [ZONES.FIELD];
      if (["normal", "magic", "trap"].includes(definition.cardType)) return HAND_ZONES;
      if (definition.cardType === "field") return [ZONES.FIELD];
      return null;
    }

    if (definition.cardType === "monster") return [ZONES.FIELD];
    if (["normal", "magic", "trap"].includes(definition.cardType)) return HAND_ZONES;
    if (definition.cardType === "field") return [ZONES.FIELD];
    return null;
  }

  isSourceZoneLegal(state, sourceCard, definition, effect) {
    const allowed = this.getDefaultSourceZones(definition, effect);
    if (!allowed) return true;
    const location = this.findCardLocation(state, sourceCard);
    return Boolean(location && allowed.includes(location.zone));
  }

  getEffectLimitRule(definition, effectId) {
    return (definition.nonEffectText || []).find((rule) =>
      rule.type === "EFFECT_LIMIT" && asArray(rule.effectIds).includes(effectId)
    ) || null;
  }

  getUsageKey(controller, definition, effect, rule) {
    if (!rule || rule.mode === "EACH") return `${controller}:${definition.id}:${effect.id}`;
    return `${controller}:${definition.id}:GROUP:${asArray(rule.effectIds).join(",")}`;
  }

  checkEffectLimit(state, controller, definition, effect) {
    const rule = this.getEffectLimitRule(definition, effect.id);
    if (!rule) return true;
    const key = this.getUsageKey(controller, definition, effect, rule);
    const usage = state.effectUsage[key] || { turn: null, turnCount: 0, gameCount: 0 };
    if (rule.scope === "GAME") return usage.gameCount < rule.count;
    if (rule.scope === "TURN") {
      const count = usage.turn === state.turn.number ? usage.turnCount : 0;
      return count < rule.count;
    }
    return true;
  }

  markEffectUsed(state, controller, definition, effect) {
    const rule = this.getEffectLimitRule(definition, effect.id);
    if (!rule) return;
    const key = this.getUsageKey(controller, definition, effect, rule);
    const usage = state.effectUsage[key] || { turn: null, turnCount: 0, gameCount: 0 };
    usage.gameCount += 1;
    if (usage.turn !== state.turn.number) {
      usage.turn = state.turn.number;
      usage.turnCount = 0;
    }
    usage.turnCount += 1;
    state.effectUsage[key] = usage;
  }

  canAddToPublicHand(state, card, ctx) {
    const definition = this.getCardDefinition(card);
    if (!definition) return false;
    return (definition.nonEffectText || [])
      .filter((rule) => rule.type === "ADD_TO_HAND_CONDITION")
      .every((rule) => this.checkCondition(state, rule.condition, ctx));
  }

  canSummonCard(state, card, ctx, summonController) {
    const definition = this.getCardDefinition(card);
    if (!definition || definition.cardType !== "monster") return false;
    const capacity = state.rules?.monsterZoneCount ?? 5;
    if (this.getZone(state, summonController, ZONES.FIELD).length >= capacity) return false;

    const restrictions = (definition.nonEffectText || []).filter((rule) => rule.type === "SUMMON_SOURCE_RESTRICTION");
    for (const rule of restrictions) {
      const allowed = asArray(rule.allowedSources).some((source) => {
        if (source.card === "SELF_CARD") return ctx.sourceCard?.instanceId === card.instanceId;
        if (source.cardId && source.cardId !== ctx.sourceCardId) return false;
        if (source.effectId != null && source.effectId !== ctx.effectId) return false;
        return Boolean(source.cardId || source.card === "SELF_CARD");
      });
      if (!allowed) return false;
    }
    return true;
  }

  canReceiveEffect(state, card, ctx) {
    if (ctx.reason !== "EFFECT") return true;
    const definition = this.getCardDefinition(card);
    if (!definition) return true;
    for (const effect of definition.effects || []) {
      if (effect.type !== EFFECT_TYPES.CONTINUOUS || effect.apply?.type !== "EFFECT_IMMUNITY") continue;
      const location = this.findCardLocation(state, card);
      if (!location || location.zone !== ZONES.FIELD) continue;
      const apply = effect.apply;
      if (apply.sourceController === "OPPONENT" && ctx.controller !== this.opponentOf(state, card.controller)) continue;
      const immunityCtx = { ...ctx, sourceCard: card };
      if (this.checkCondition(state, apply.condition, immunityCtx)) return false;
    }
    return true;
  }

  matchesEvent(state, eventSpec, event, sourceCard, controller) {
    if (!eventSpec || !event || eventSpec.type !== event.type) return false;
    const ctx = this.makeContext(state, { controller, sourceCard, triggerEvent: event });

    if (eventSpec.controller) {
      const allowed = this.resolveController(state, eventSpec.controller, controller);
      if (!allowed.includes(event.controller)) return false;
    }
    if (eventSpec.sourceCardType && event.sourceCardType !== eventSpec.sourceCardType) return false;
    if (eventSpec.from && event.from !== eventSpec.from) return false;
    if (eventSpec.target === "SELF_CARD" && event.cardInstanceId !== sourceCard.instanceId) return false;
    if (eventSpec.card) {
      const eventCard = event.cardSnapshot
        || (event.cardInstanceId ? this.findCardLocation(state, event.cardInstanceId)?.card : null);
      if (!eventCard) return false;
      if (!this.matchesCardFilter(state, eventCard, eventSpec.card, ctx)) return false;
    }
    if (eventSpec.cause) {
      if (eventSpec.cause.cardId && event.cause?.cardId !== eventSpec.cause.cardId) return false;
      if (eventSpec.cause.effectId != null && event.cause?.effectId !== eventSpec.cause.effectId) return false;
      if (eventSpec.cause.kind && event.cause?.kind !== eventSpec.cause.kind) return false;
    }
    return true;
  }

  canActivateEffect(state, sourceCard, effectId, options = {}) {
    this.ensureState(state);
    const definition = this.getCardDefinition(sourceCard);
    const effect = definition?.effects?.find((item) => item.id === effectId);
    if (!definition || !effect) return { ok: false, reason: "EFFECT_NOT_FOUND" };
    const controller = options.controller || sourceCard.controller;
    const ctx = this.makeContext(state, {
      controller,
      sourceCard,
      effect,
      triggerEvent: options.triggerEvent || null,
    });

    if (!this.isSourceZoneLegal(state, sourceCard, definition, effect)) return { ok: false, reason: "SOURCE_ZONE" };
    if (!this.checkTiming(state, effect.timing, controller)) return { ok: false, reason: "TIMING" };
    if (!this.checkCondition(state, effect.condition, ctx)) return { ok: false, reason: "CONDITION" };
    if (!this.checkEffectLimit(state, controller, definition, effect)) return { ok: false, reason: "LIMIT" };
    if (effect.event && !this.matchesEvent(state, effect.event, options.triggerEvent, sourceCard, controller)) {
      return { ok: false, reason: "EVENT" };
    }
    if (effect.type === EFFECT_TYPES.CONTINUOUS || effect.type === EFFECT_TYPES.REPLACEMENT) {
      return { ok: false, reason: "NOT_ACTIVATABLE" };
    }
    if (!this.canPayCosts(state, effect.cost || [], ctx)) return { ok: false, reason: "COST" };
    if (!this.canChooseTargets(state, effect.target, ctx)) return { ok: false, reason: "TARGET" };
    return { ok: true, definition, effect, ctx };
  }

  canPayCosts(state, costs, ctx) {
    return asArray(costs).every((cost) => this.canPerformAction(state, cost, ctx, { asCost: true }));
  }

  canChooseTargets(state, targetSpec, ctx) {
    if (!targetSpec) return true;
    const groups = targetSpec.groups || [targetSpec];
    return groups.every((group) => {
      const selector = group.selector || group;
      const candidates = this.getCandidates(state, selector, ctx);
      const { min } = this.normalizeCount(selector.count, ctx, { min: 1, max: 1 });
      return candidates.length >= min;
    });
  }

  canPerformAction(state, action, ctx) {
    if (!action) return true;
    if (action.optional) return true;
    switch (action.type) {
      case "REVEAL":
      case "BANISH":
      case "DISCARD":
      case "SEND_TO_GRAVE":
      case "RETURN_TO_HAND":
      case "RETURN_TO_DECK": {
        if (action.target === "SELF_CARD") return Boolean(this.findCardLocation(state, ctx.sourceCard));
        const selector = action.choice || action.selector || {};
        const candidates = this.getCandidates(state, selector, ctx, action.from);
        const { min } = this.normalizeCount(selector.count, ctx, { min: 1, max: 1 });
        return candidates.length >= min;
      }
      case "SEARCH": {
        const selector = action.choice || action.selector || {};
        const candidates = this.getCandidates(state, selector, ctx, action.from)
          .filter((card) => this.canAddToPublicHand(state, card, ctx));
        const { min } = this.normalizeCount(selector.count, ctx, { min: 1, max: 1 });
        return candidates.length >= min;
      }
      case "SUMMON": {
        if (action.target === "SELF_CARD") return this.canSummonCard(state, ctx.sourceCard, ctx, ctx.controller);
        const selector = action.choice || action.selector || {};
        const candidates = this.getCandidates(state, selector, ctx, action.from)
          .filter((card) => this.canSummonCard(state, card, ctx, ctx.controller));
        const { min } = this.normalizeCount(selector.count, ctx, { min: 1, max: 1 });
        return candidates.length >= min;
      }
      case "DRAW": {
        const playerId = action.player === "OPPONENT" ? this.opponentOf(state, ctx.controller) : ctx.controller;
        return this.getZone(state, playerId, ZONES.DECK).length > 0;
      }
      case "CHANGE_ATK":
      case "NEGATE_EFFECT":
      case "REVEAL_HAND":
      case "REPEAT":
        return true;
      default:
        throw new Error(`지원하지 않는 Action 타입입니다: ${action.type}`);
    }
  }

  async resolveTargets(state, targetSpec, ctx) {
    if (!targetSpec) return;
    const groups = targetSpec.groups || [targetSpec];
    for (const group of groups) {
      const id = group.id || targetSpec.id || `target${Object.keys(ctx.targets).length + 1}`;
      const selector = group.selector || group;
      const selected = await this.selectCards(state, selector, ctx, {
        choosingPlayer: ctx.controller,
        prompt: "대상을 선택하세요.",
      });
      const { min } = this.normalizeCount(selector.count, ctx, { min: 1, max: 1 });
      if (selected.length < min) throw new Error("필요한 대상을 선택하지 못했습니다.");
      ctx.targets[id] = selected;
      for (const card of selected) ctx.activationTargetInstanceIds.add(card.instanceId);
    }
  }

  async activateEffect(state, request) {
    this.ensureState(state);
    const sourceCard = typeof request.instanceId === "string"
      ? this.findCardLocation(state, request.instanceId)?.card
      : request.sourceCard;
    if (!sourceCard) return { ok: false, reason: "CARD_NOT_FOUND" };

    const check = this.canActivateEffect(state, sourceCard, request.effectId, request);
    if (!check.ok) return check;
    const { definition, effect } = check;
    const controller = request.controller || sourceCard.controller;
    const ctx = this.makeContext(state, {
      controller,
      sourceCard,
      effect,
      reason: "EFFECT",
      triggerEvent: request.triggerEvent || null,
      targets: {},
      activationTargetInstanceIds: new Set(),
      results: {},
    });

    await this.executeActions(state, effect.cost || [], { ...ctx, reason: "COST" });
    await this.resolveTargets(state, effect.target, ctx);
    this.markEffectUsed(state, controller, definition, effect);

    const link = {
      id: `L${state.nextChainNumber++}`,
      controller,
      sourceInstanceId: sourceCard.instanceId,
      sourceCardId: sourceCard.cardId,
      effectId: effect.id,
      effectType: effect.type,
      effect,
      targets: ctx.targets,
      activationTargetInstanceIds: [...ctx.activationTargetInstanceIds],
      triggerEvent: request.triggerEvent || null,
      triggeringEffectLinkId: request.triggerEvent?.effectLinkId || null,
      negated: false,
      resolved: false,
    };
    state.chain.push(link);

    const activationEvent = this.emitEvent(state, {
      type: "EFFECT_ACTIVATED",
      controller,
      sourceCardId: sourceCard.cardId,
      sourceCardType: definition.cardType,
      sourceInstanceId: sourceCard.instanceId,
      effectId: effect.id,
      effectLinkId: link.id,
    }, { pending: false });

    return {
      ok: true,
      link,
      event: activationEvent,
      responses: this.getTriggeredEffects(state, activationEvent),
    };
  }

  async resolveChain(state) {
    this.ensureState(state);
    const resolved = [];
    while (state.chain.length) {
      const link = state.chain.pop();
      const sourceCard = this.findCardLocation(state, link.sourceInstanceId)?.card
        || this.allInstances(state).find((card) => card.instanceId === link.sourceInstanceId)
        || { instanceId: link.sourceInstanceId, cardId: link.sourceCardId, controller: link.controller, owner: link.controller, zone: null, statChanges: [] };
      const ctx = this.makeContext(state, {
        controller: link.controller,
        sourceCard,
        effect: link.effect,
        reason: "EFFECT",
        triggerEvent: link.triggerEvent,
        triggeringEffectLinkId: link.triggeringEffectLinkId,
        targets: link.targets,
        activationTargetInstanceIds: new Set(link.activationTargetInstanceIds || []),
        results: {},
        chainLink: link,
        cause: {
          kind: "EFFECT",
          cardId: link.sourceCardId,
          effectId: link.effectId,
          controller: link.controller,
          linkId: link.id,
        },
      });

      if (!link.negated) await this.executeActions(state, link.effect.resolution || [], ctx);
      link.resolved = true;
      resolved.push(link);
      this.emitEvent(state, {
        type: "EFFECT_RESOLVED",
        controller: link.controller,
        sourceCardId: link.sourceCardId,
        effectId: link.effectId,
        effectLinkId: link.id,
        negated: link.negated,
      });
    }
    return { resolved, pendingEvents: state.pendingEvents.slice() };
  }

  getTriggeredEffects(state, event, options = {}) {
    const results = [];
    for (const sourceCard of this.allInstances(state)) {
      if (options.playerId && sourceCard.controller !== options.playerId && sourceCard.owner !== options.playerId) continue;
      const definition = this.getCardDefinition(sourceCard);
      for (const effect of definition?.effects || []) {
        if (![EFFECT_TYPES.TRIGGER, EFFECT_TYPES.QUICK].includes(effect.type) || !effect.event) continue;
        const check = this.canActivateEffect(state, sourceCard, effect.id, {
          controller: sourceCard.controller,
          triggerEvent: event,
        });
        if (check.ok) {
          results.push({
            playerId: sourceCard.controller,
            instanceId: sourceCard.instanceId,
            cardId: sourceCard.cardId,
            effectId: effect.id,
            optional: effect.optional !== false,
            text: effect.text,
            event,
          });
        }
      }
    }
    return results;
  }

  getAvailableEffects(state, playerId) {
    const result = [];
    for (const sourceCard of this.allInstances(state)) {
      if (sourceCard.controller !== playerId && sourceCard.owner !== playerId) continue;
      const definition = this.getCardDefinition(sourceCard);
      for (const effect of definition?.effects || []) {
        if (![EFFECT_TYPES.ACTIVATED, EFFECT_TYPES.QUICK].includes(effect.type) || effect.event) continue;
        const check = this.canActivateEffect(state, sourceCard, effect.id, { controller: playerId });
        if (check.ok) result.push({ instanceId: sourceCard.instanceId, cardId: sourceCard.cardId, effectId: effect.id, text: effect.text });
      }
    }
    return result;
  }

  emitEvent(state, payload, options = {}) {
    const event = {
      id: `E${state.nextEventNumber++}`,
      ...deepClone(payload),
    };
    state.eventHistory.push(event);
    if (options.pending !== false) state.pendingEvents.push(event);
    this.onEvent(event, state);
    return event;
  }

  drainPendingEvents(state) {
    const events = state.pendingEvents.slice();
    state.pendingEvents.length = 0;
    return events;
  }

  async executeActions(state, actions, ctx) {
    const results = [];
    for (const action of asArray(actions)) {
      if (action.optional) {
        const shouldApply = await this.chooseYesNo({
          controller: ctx.controller,
          prompt: action.prompt || "이 처리를 적용하시겠습니까?",
          action,
          context: ctx,
        });
        if (!shouldApply) {
          results.push([]);
          continue;
        }
      }
      const result = await this.executeAction(state, action, ctx);
      if (action.storeAs) ctx.results[action.storeAs] = result;
      results.push(result);
    }
    return results;
  }

  async executeAction(state, action, ctx) {
    switch (action.type) {
      case "REVEAL":
        return this.actionReveal(state, action, ctx);
      case "REVEAL_HAND":
        return this.actionRevealHand(state, action, ctx);
      case "DRAW":
        return this.actionDraw(state, action, ctx);
      case "SEARCH":
        return this.actionSearch(state, action, ctx);
      case "SUMMON":
        return this.actionSummon(state, action, ctx);
      case "DISCARD":
        return this.actionDiscard(state, action, ctx);
      case "BANISH":
        return this.actionMoveByMeaning(state, action, ctx, ZONES.EXILE, "BANISH");
      case "SEND_TO_GRAVE":
        return this.actionMoveByMeaning(state, action, ctx, ZONES.GRAVE, "SEND_TO_GRAVE");
      case "RETURN_TO_HAND":
        return this.actionReturnToHand(state, action, ctx);
      case "RETURN_TO_DECK":
        return this.actionMoveByMeaning(state, action, ctx, ZONES.DECK, "RETURN_TO_DECK");
      case "CHANGE_ATK":
        return this.actionChangeAtk(state, action, ctx);
      case "NEGATE_EFFECT":
        return this.actionNegateEffect(state, action, ctx);
      case "REPEAT":
        return this.actionRepeat(state, action, ctx);
      default:
        throw new Error(`지원하지 않는 Action 타입입니다: ${action.type}`);
    }
  }

  async actionReveal(state, action, ctx) {
    const cardsToReveal = action.target === "SELF_CARD"
      ? [ctx.sourceCard]
      : await this.selectCards(state, action.choice || action.selector || {}, ctx);
    const revealed = [];
    for (const card of cardsToReveal) {
      const location = this.findCardLocation(state, card);
      if (!location) continue;
      if (location.zone === ZONES.HAND) {
        await this.moveCard(state, card, ZONES.PUBLIC_HAND, {
          destinationPlayer: location.playerId,
          reason: ctx.reason,
          cause: this.getCause(ctx),
          semantic: "REVEAL",
          emitAddedToPublicHand: false,
        });
      }
      revealed.push(card);
      this.emitEvent(state, {
        type: "REVEALED",
        controller: card.controller,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
      });
    }
    return revealed;
  }

  async actionRevealHand(state, action, ctx) {
    const playerId = action.player === "OPPONENT" ? this.opponentOf(state, ctx.controller) : ctx.controller;
    const hand = this.getZone(state, playerId, ZONES.HAND).slice();
    for (const card of hand) {
      await this.moveCard(state, card, ZONES.PUBLIC_HAND, {
        destinationPlayer: playerId,
        reason: ctx.reason,
        cause: this.getCause(ctx),
        semantic: "REVEAL_HAND",
        emitAddedToPublicHand: false,
      });
    }
    this.emitEvent(state, { type: "HAND_REVEALED", controller: playerId, count: hand.length });
    return hand;
  }

  async actionDraw(state, action, ctx) {
    const playerId = action.player === "OPPONENT" ? this.opponentOf(state, ctx.controller) : ctx.controller;
    const count = clampInteger(this.evaluateExpression(action.count ?? 1, ctx));
    const drawn = [];
    for (let i = 0; i < count; i += 1) {
      const deck = this.getZone(state, playerId, ZONES.DECK);
      if (!deck.length) break;
      const card = deck[0];
      await this.moveCard(state, card, ZONES.HAND, {
        destinationPlayer: playerId,
        reason: ctx.reason,
        cause: this.getCause(ctx),
        semantic: "DRAW",
      });
      drawn.push(card);
    }
    this.emitEvent(state, { type: "DRAWN", controller: playerId, count: drawn.length, cardInstanceIds: drawn.map((card) => card.instanceId) });
    return drawn;
  }

  async actionSearch(state, action, ctx) {
    const selector = action.choice || action.selector || {};
    const selected = await this.selectCards(state, selector, ctx, {
      from: action.from,
      requireAddToPublicHand: true,
      choosingPlayer: ctx.controller,
      prompt: "패에 넣을 카드를 선택하세요.",
    });
    const searched = [];
    for (const card of selected) {
      const destinationPlayer = card.owner;
      const moved = await this.moveCard(state, card, ZONES.PUBLIC_HAND, {
        destinationPlayer,
        reason: ctx.reason,
        cause: this.getCause(ctx),
        semantic: "SEARCH",
        emitAddedToPublicHand: true,
      });
      if (moved) searched.push(card);
    }
    if (searched.length) {
      this.emitEvent(state, {
        type: "SEARCHED",
        controller: ctx.controller,
        cardInstanceIds: searched.map((card) => card.instanceId),
        from: asArray(action.from),
      });
    }
    return searched;
  }

  async actionSummon(state, action, ctx) {
    let selected;
    if (action.target === "SELF_CARD") {
      selected = this.canSummonCard(state, ctx.sourceCard, ctx, ctx.controller) ? [ctx.sourceCard] : [];
    } else {
      selected = await this.selectCards(state, action.choice || action.selector || {}, ctx, {
        from: action.from,
        requireSummon: true,
        summonController: ctx.controller,
        choosingPlayer: ctx.controller,
        prompt: "소환할 몬스터를 선택하세요.",
      });
    }

    const summoned = [];
    for (const card of selected) {
      if (!this.canSummonCard(state, card, ctx, ctx.controller)) continue;
      const from = this.findCardLocation(state, card)?.zone || null;
      const moved = await this.moveCard(state, card, ZONES.FIELD, {
        destinationPlayer: ctx.controller,
        newController: ctx.controller,
        reason: ctx.reason,
        cause: this.getCause(ctx),
        semantic: "SUMMON",
      });
      if (!moved) continue;
      card.statChanges = [];
      summoned.push(card);
      this.emitEvent(state, {
        type: "SUMMONED",
        controller: ctx.controller,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        from,
        cause: this.getCause(ctx),
      });
    }
    return summoned;
  }

  async actionDiscard(state, action, ctx) {
    const selector = action.choice || action.selector || {};
    const selected = await this.selectCards(state, selector, ctx, {
      from: HAND_ZONES,
      choosingPlayer: selector.controller === "OPPONENT" ? this.opponentOf(state, ctx.controller) : ctx.controller,
      prompt: "버릴 카드를 선택하세요.",
    });

    const discarded = [];
    for (const card of selected) {
      const location = this.findCardLocation(state, card);
      if (!location || !HAND_ZONES.includes(location.zone)) continue;
      const wouldEvent = {
        type: "WOULD_DISCARD",
        controller: card.controller,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        from: location.zone,
        reason: ctx.reason,
        cause: this.getCause(ctx),
      };
      const replaced = await this.tryReplacement(state, wouldEvent, ctx);
      if (replaced) {
        discarded.push(card);
        continue;
      }

      const moved = await this.moveCard(state, card, ZONES.GRAVE, {
        destinationPlayer: card.owner,
        reason: ctx.reason,
        cause: this.getCause(ctx),
        semantic: "DISCARD",
      });
      if (moved) {
        discarded.push(card);
        this.emitEvent(state, {
          type: "DISCARDED",
          controller: card.controller,
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          from: location.zone,
          reason: ctx.reason,
          cause: this.getCause(ctx),
        });
      }
    }
    return discarded;
  }

  async actionMoveByMeaning(state, action, ctx, destinationZone, semantic) {
    let selected;
    if (action.target === "SELF_CARD") selected = [ctx.sourceCard];
    else if (action.targetRefs) selected = action.targetRefs.flatMap((ref) => asArray(ctx.targets[ref]));
    else selected = await this.selectCards(state, action.choice || action.selector || {}, ctx, {
      from: action.from,
      choosingPlayer: ctx.controller,
      applyImmunity: true,
      prompt: "카드를 선택하세요.",
    });

    const movedCards = [];
    for (const card of selected) {
      if (!this.canReceiveEffect(state, card, ctx) && ctx.reason === "EFFECT") continue;
      const destinationPlayer = destinationZone === ZONES.FIELD ? ctx.controller : card.owner;
      const moved = await this.moveCard(state, card, destinationZone, {
        destinationPlayer,
        reason: ctx.reason,
        cause: this.getCause(ctx),
        semantic,
      });
      if (moved) movedCards.push(card);
    }
    return movedCards;
  }

  async actionReturnToHand(state, action, ctx) {
    let selected;
    if (action.target === "SELF_CARD") selected = [ctx.sourceCard];
    else if (action.targetRefs) selected = action.targetRefs.flatMap((ref) => asArray(ctx.targets[ref]));
    else selected = await this.selectCards(state, action.choice || action.selector || {}, ctx, {
      from: action.from,
      choosingPlayer: ctx.controller,
      applyImmunity: true,
    });

    const returned = [];
    for (const card of selected) {
      if (!this.canReceiveEffect(state, card, ctx) && ctx.reason === "EFFECT") continue;
      if (!this.canAddToPublicHand(state, card, ctx)) continue;
      const moved = await this.moveCard(state, card, ZONES.PUBLIC_HAND, {
        destinationPlayer: card.owner,
        reason: ctx.reason,
        cause: this.getCause(ctx),
        semantic: "RETURN_TO_HAND",
        emitAddedToPublicHand: true,
      });
      if (moved) returned.push(card);
    }
    if (returned.length) {
      this.emitEvent(state, {
        type: "SEARCHED",
        controller: ctx.controller,
        method: "RETURN_TO_HAND",
        cardInstanceIds: returned.map((card) => card.instanceId),
      });
    }
    return returned;
  }

  async actionChangeAtk(state, action, ctx) {
    let targets;
    if (action.target === "SELF_CARD") targets = [ctx.sourceCard];
    else if (action.targetRef) targets = asArray(ctx.targets[action.targetRef]);
    else targets = await this.selectCards(state, action.selector || action.choice || {}, ctx, {
      choosingPlayer: ctx.controller,
      applyImmunity: true,
    });

    const value = this.evaluateExpression(action.value, ctx);
    const changed = [];
    for (const card of targets) {
      if (!this.canReceiveEffect(state, card, ctx) && ctx.reason === "EFFECT") continue;
      const amount = action.operation === "SUBTRACT" ? -value : value;
      card.statChanges ||= [];
      card.statChanges.push({ amount, duration: action.duration || "WHILE_ON_FIELD", source: this.getCause(ctx) });
      changed.push(card);
      this.emitEvent(state, {
        type: "STAT_CHANGED",
        controller: card.controller,
        cardInstanceId: card.instanceId,
        stat: "ATK",
        amount,
        duration: action.duration || "WHILE_ON_FIELD",
        cause: this.getCause(ctx),
      });
    }
    return changed;
  }

  async actionNegateEffect(state, action, ctx) {
    let linkId = null;
    if (action.target === "TRIGGERING_EFFECT") linkId = ctx.triggeringEffectLinkId;
    if (!linkId) return [];
    const targetLink = state.chain.find((link) => link.id === linkId);
    if (!targetLink) return [];
    targetLink.negated = true;
    this.emitEvent(state, {
      type: "EFFECT_NEGATED",
      controller: ctx.controller,
      targetEffectLinkId: linkId,
      cause: this.getCause(ctx),
    });
    return [targetLink];
  }

  async actionRepeat(state, action, ctx) {
    const min = clampInteger(action.min ?? 0);
    const max = action.max === "UNBOUNDED" ? Number.MAX_SAFE_INTEGER : clampInteger(action.max ?? 1, min);
    const iterations = [];

    for (let index = 0; index < max; index += 1) {
      const legal = asArray(action.actions).every((nested) => this.canPerformAction(state, nested, ctx));
      if (!legal && action.continueWhileAllActionsLegal) break;

      if (index >= min && action.mode === "PLAYER_CHOOSES") {
        const again = await this.chooseRepeat({
          controller: ctx.controller,
          iteration: index,
          actions: action.actions,
          context: ctx,
        });
        if (!again) break;
      }

      const result = await this.executeActions(state, action.actions || [], ctx);
      iterations.push(result);
    }
    return iterations;
  }

  getCause(ctx) {
    return ctx.cause || {
      kind: ctx.reason === "COST" ? "COST" : "EFFECT",
      cardId: ctx.sourceCardId,
      effectId: ctx.effectId,
      controller: ctx.controller,
      linkId: ctx.chainLink?.id || null,
    };
  }

  async moveCard(state, card, toZone, options = {}) {
    const location = this.findCardLocation(state, card);
    if (!location) return false;
    const snapshot = {
      instanceId: card.instanceId,
      cardId: card.cardId,
      owner: card.owner,
      controller: card.controller,
      zone: location.zone,
      statChanges: deepClone(card.statChanges || []),
      flags: deepClone(card.flags || {}),
    };

    this.getZone(state, location.playerId, location.zone).splice(location.index, 1);
    const destinationPlayer = options.destinationPlayer || (toZone === ZONES.FIELD ? card.controller : card.owner);
    card.zone = toZone;
    if (options.newController) card.controller = options.newController;
    else if (toZone !== ZONES.FIELD) card.controller = card.owner;

    if (location.zone === ZONES.FIELD && toZone !== ZONES.FIELD) card.statChanges = [];
    this.getZone(state, destinationPlayer, toZone).push(card);

    this.emitEvent(state, {
      type: "CARD_MOVED",
      controller: card.controller,
      cardInstanceId: card.instanceId,
      cardId: card.cardId,
      from: location.zone,
      to: toZone,
      reason: options.reason || "EFFECT",
      semantic: options.semantic || "MOVE",
      cause: options.cause || null,
      cardSnapshot: snapshot,
    });

    if (toZone === ZONES.GRAVE) {
      this.emitEvent(state, {
        type: "SENT_TO_GRAVE",
        controller: snapshot.controller,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        from: location.zone,
        reason: options.reason || "EFFECT",
        cause: options.cause || null,
        cardSnapshot: snapshot,
      });
    }

    if (toZone === ZONES.PUBLIC_HAND && options.emitAddedToPublicHand) {
      this.emitEvent(state, {
        type: "ADDED_TO_PUBLIC_HAND",
        controller: card.owner,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        from: location.zone,
        reason: options.reason || "EFFECT",
        semantic: options.semantic || "SEARCH",
        cause: options.cause || null,
      });
    }
    return true;
  }

  async tryReplacement(state, wouldEvent) {
    for (const sourceCard of this.allInstances(state)) {
      const definition = this.getCardDefinition(sourceCard);
      for (const effect of definition?.effects || []) {
        if (effect.type !== EFFECT_TYPES.REPLACEMENT || !effect.event || !effect.replacement) continue;
        const controller = sourceCard.controller;
        if (!this.matchesEvent(state, effect.event, wouldEvent, sourceCard, controller)) continue;
        const ctx = this.makeContext(state, {
          controller,
          sourceCard,
          effect,
          reason: "EFFECT",
          triggerEvent: wouldEvent,
          cause: {
            kind: "EFFECT",
            cardId: sourceCard.cardId,
            effectId: effect.id,
            controller,
          },
        });
        if (!this.checkCondition(state, effect.condition, ctx)) continue;
        if (!asArray(effect.replacement.actions).every((action) => this.canPerformAction(state, action, ctx))) continue;

        if (effect.optional !== false) {
          const useIt = await this.chooseYesNo({
            controller,
            prompt: effect.text || "대체 효과를 적용하시겠습니까?",
            effect,
            context: ctx,
          });
          if (!useIt) continue;
        }

        await this.executeActions(state, effect.replacement.actions, ctx);
        this.emitEvent(state, {
          type: "EVENT_REPLACED",
          controller,
          originalEvent: wouldEvent,
          sourceCardId: sourceCard.cardId,
          effectId: effect.id,
        });
        return effect.replacement.cancelOriginal !== false;
      }
    }
    return false;
  }

  cleanupDuration(state, duration) {
    for (const card of this.allInstances(state)) {
      card.statChanges = (card.statChanges || []).filter((change) => change.duration !== duration);
    }
  }

  endTurn(state, nextPlayer = null) {
    this.cleanupDuration(state, "END_OF_TURN");
    const current = state.turn.activePlayer;
    state.turn.number += 1;
    state.turn.activePlayer = nextPlayer || this.opponentOf(state, current);
    state.turn.phase = "DRAW";
    this.emitEvent(state, { type: "TURN_ENDED", controller: current });
    this.emitEvent(state, { type: "TURN_STARTED", controller: state.turn.activePlayer });
  }

  setPhase(state, phase) {
    state.turn.phase = phase;
    this.emitEvent(state, { type: "PHASE_CHANGED", controller: state.turn.activePlayer, phase });
  }
}

export const engine = new HandBattleEngine();
