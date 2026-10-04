import { normalizeDeckFile, validateDeck } from "./deck-format.mjs";

const $ = (id) => document.getElementById(id);
const setupView = $("setupView");
const duelView = $("duelView");
const catalogById = new Map();
let catalog = [];
let aiDeck = null;
let gameCode = null;
let latestSnapshot = null;
let selectedUid = null;
let selectedChoiceValues = new Set();
let pollTimer = null;
let apiBaseUrl = (window.HAND_BATTLE_AI_API_BASE_URL || window.location.origin).replace(/\/$/, "");

$("apiBaseInput").value = apiBaseUrl;

function setMessage(element, text, kind) {
  element.textContent = text || "";
  element.className = "inline-message" + (kind ? " " + kind : "");
}

function setConnection(text, kind) {
  const el = $("connectionStatus");
  const dot = el.querySelector(".status-dot");
  dot.className = "status-dot" + (kind ? " " + kind : "");
  el.lastElementChild.textContent = text;
}

async function requestJson(path, options = {}) {
  const response = await fetch(apiBaseUrl + path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    cache: "no-store",
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = data.error;
    const message = typeof error === "string" ? error : error && error.message;
    throw new Error(message || ("서버 요청 실패 (" + response.status + ")"));
  }
  return data;
}

function currentApiBase() {
  apiBaseUrl = $("apiBaseInput").value.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(apiBaseUrl)) throw new Error("대전 서버 주소는 https:// 또는 http://로 시작해야 합니다.");
  return apiBaseUrl;
}

async function loadCatalog() {
  try {
    currentApiBase();
    const data = await requestJson("/api/cards");
    catalog = data.cards || [];
    catalogById.clear();
    for (const card of catalog) catalogById.set(card.id, card);
    $("catalogBadge").textContent = catalog.length + "종 카드 준비됨";
    $("catalogBadge").classList.add("ready");
    $("startButton").disabled = false;
    setConnection("대전 서버 연결됨", "online");
    if (sessionStorage.getItem("hand-battle-ai-game")) await restoreGame();
  } catch (error) {
    $("catalogBadge").textContent = "서버에 연결할 수 없음";
    $("startButton").disabled = true;
    setConnection("서버 연결 실패", "error");
    setMessage($("setupMessage"), error.message, "error");
  }
}

function summarizeDeck(deck) {
  const names = new Map();
  for (const id of deck.main) names.set(id, (names.get(id) || 0) + 1);
  const keys = new Set(deck.key).size;
  return deck.main.length + "장 메인 · " + keys + "장 키 카드 · " + names.size + "종";
}

function inspectDeck(showSuccess = true) {
  try {
    const parsed = normalizeDeckFile(JSON.parse($("aiDeckInput").value));
    const errors = validateDeck(parsed, catalog);
    aiDeck = parsed;
    $("deckSummary").textContent = summarizeDeck(parsed);
    if (errors.length) {
      setMessage($("deckMessage"), errors.join(" "), "error");
      return false;
    }
    setMessage($("deckMessage"), showSuccess ? "덱이 규칙에 맞습니다." : "", showSuccess ? "success" : "");
    return true;
  } catch (error) {
    aiDeck = null;
    $("deckSummary").textContent = "덱을 읽지 못했습니다.";
    setMessage($("deckMessage"), error.message, "error");
    return false;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => refreshGame(false), 1600);
}

async function startGame() {
  setMessage($("setupMessage"), "", "");
  try {
    currentApiBase();
    if (!inspectDeck()) return;
    $("startButton").disabled = true;
    setConnection("대전을 준비 중", "waiting");
    const provider = $("providerSelect").value;
    const name = $("aiNameInput").value.trim() || provider;
    const created = await requestJson("/api/games", {
      method: "POST",
      body: JSON.stringify({ ai_deck: aiDeck, ai_name: name }),
    });
    gameCode = created.code;
    sessionStorage.setItem("hand-battle-ai-game", gameCode);
    sessionStorage.setItem("hand-battle-ai-provider", provider);
    $("duelAiName").textContent = name;
    $("opponentName").textContent = name;
    $("gameCodeText").textContent = gameCode;
    $("mcpEndpointText").textContent = apiBaseUrl + "/mcp";
    $("manualAiCard").hidden = provider !== "ChatGPT";
    setupView.hidden = true;
    duelView.hidden = false;
    latestSnapshot = null;
    selectedUid = null;
    await refreshGame(true);
    startPolling();
  } catch (error) {
    setMessage($("setupMessage"), error.message, "error");
    $("startButton").disabled = false;
    setConnection("대전 시작 실패", "error");
  }
}

async function restoreGame() {
  const savedCode = sessionStorage.getItem("hand-battle-ai-game");
  if (!savedCode) return;
  try {
    gameCode = savedCode;
    const provider = sessionStorage.getItem("hand-battle-ai-provider") || "ChatGPT";
    $("gameCodeText").textContent = gameCode;
    $("mcpEndpointText").textContent = apiBaseUrl + "/mcp";
    $("manualAiCard").hidden = provider !== "ChatGPT";
    setupView.hidden = true;
    duelView.hidden = false;
    await refreshGame(true);
    startPolling();
  } catch (error) {
    sessionStorage.removeItem("hand-battle-ai-game");
    gameCode = null;
    setupView.hidden = false;
    duelView.hidden = true;
    setMessage($("setupMessage"), "저장된 대전을 불러오지 못했습니다: " + error.message, "error");
  }
}

async function refreshGame(showErrors = false) {
  if (!gameCode) return;
  try {
    const data = await requestJson("/api/games/" + encodeURIComponent(gameCode) + "/state");
    if (!latestSnapshot || data.revision !== latestSnapshot.revision) {
      selectedUid = latestSnapshot && selectedUid && data.snapshot.players[0].hand.concat(data.snapshot.players[0].field, data.snapshot.players[0].grave, data.snapshot.players[0].banished, data.snapshot.players[0].keyDeck).some((card) => card.uid === selectedUid)
        ? selectedUid
        : null;
      latestSnapshot = data.snapshot;
      $("duelAiName").textContent = data.aiName || $("duelAiName").textContent;
      $("opponentName").textContent = data.aiName || "AI 플레이어";
      renderDuel(data.snapshot, data.aiName);
    }
    setConnection("실시간 대전 상태 연결됨", "online");
  } catch (error) {
    setConnection("대전 서버 재연결 중", "waiting");
    if (showErrors) setMessage($("duelMessage"), error.message, "error");
  }
}

function cardTypeLabel(card) {
  const typeMap = { monster: "몬스터", normal: "일반 카드", spell: "마법", trap: "함정", field: "필드" };
  return (card.deck === "key" ? "키 카드 · " : "") + (typeMap[card.type] || card.type || "카드");
}

function definitionFor(card) {
  return (card && card.id && catalogById.get(card.id)) || card || {};
}

function showCard(card) {
  if (!card || card.hidden) return;
  selectedUid = card.uid || null;
  const def = definitionFor(card);
  const detail = $("cardInspector");
  detail.className = "card-inspector";
  detail.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = def.name || card.name || "카드";
  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = cardTypeLabel({ ...card, ...def }) + (card.currentAttack !== null && card.currentAttack !== undefined ? " · 공격력 " + card.currentAttack : "");
  const description = document.createElement("div");
  description.textContent = def.description || "효과 텍스트가 없습니다.";
  detail.append(name, meta, description);
  if (latestSnapshot) renderActions(latestSnapshot);
}

function makeCardButton(card, zone) {
  const button = document.createElement("button");
  const def = definitionFor(card);
  button.type = "button";
  button.className = "card-tile" + (def.type === "spell" || def.type === "field" || def.type === "normal" ? " spell" : "") + (def.type === "trap" ? " trap" : "") + (def.deck === "key" ? " key" : "") + (selectedUid && card.uid === selectedUid ? " selected" : "");
  button.setAttribute("aria-label", (def.name || card.name || "카드") + (zone ? " · " + zone : ""));
  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = def.name || card.name || "카드";
  const type = document.createElement("span");
  type.className = "card-type";
  type.textContent = cardTypeLabel({ ...card, ...def });
  button.append(name, type);
  if (card.currentAttack !== null && card.currentAttack !== undefined) {
    const atk = document.createElement("span");
    atk.className = "card-attack";
    atk.textContent = "ATK " + card.currentAttack;
    button.append(atk);
  }
  button.addEventListener("click", () => showCard(card));
  return button;
}

function renderHand(container, player, isOpponent) {
  container.replaceChildren();
  if (isOpponent) {
    const total = Math.min(player.handCount, 12);
    for (let index = 0; index < total; index += 1) {
      const back = document.createElement("span");
      back.className = "card-back";
      back.setAttribute("aria-hidden", "true");
      container.append(back);
    }
    if (player.handCount > total) {
      const extra = document.createElement("span");
      extra.className = "muted-copy";
      extra.textContent = "+" + (player.handCount - total);
      container.append(extra);
    }
    return;
  }
  if (!player.hand.length) {
    const empty = document.createElement("span");
    empty.className = "muted-copy";
    empty.textContent = "패가 비었습니다.";
    container.append(empty);
    return;
  }
  for (const card of player.hand) container.append(makeCardButton(card, "내 패"));
}

function renderField(container, cards, emptyText) {
  container.replaceChildren();
  if (!cards.length) {
    const empty = document.createElement("span");
    empty.className = "muted-copy";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const card of cards) container.append(makeCardButton(card, "몬스터 존"));
}

function renderMinorZone(container, title, cards, zone, isKey = false) {
  container.replaceChildren();
  const caption = document.createElement("span");
  caption.className = "zone-caption";
  caption.textContent = title;
  container.append(caption);
  if (!cards.length) {
    const none = document.createElement("span");
    none.textContent = "—";
    container.append(none);
    return;
  }
  for (const card of cards.slice(-5)) {
    const def = definitionFor(card);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-card" + (isKey ? " key" : "");
    button.textContent = def.name || card.name || "카드";
    button.title = (def.name || card.name || "카드") + " · " + zone;
    button.addEventListener("click", () => showCard(card));
    container.append(button);
  }
  if (cards.length > 5) {
    const more = document.createElement("span");
    more.textContent = "+" + (cards.length - 5);
    container.append(more);
  }
}

function phaseLabel(phase) {
  return { draw: "드로우", deploy: "전개", attack: "공격", end: "엔드" }[phase] || phase;
}

function renderDuel(snapshot, aiName) {
  const human = snapshot.players[0];
  const ai = snapshot.players[1];
  const humanTurn = snapshot.turnSeat === 0;
  const turnSeatName = humanTurn ? "내 차례" : (aiName || "AI") + " 차례";
  $("turnText").textContent = snapshot.finished ? "대전 종료" : turnSeatName + " · " + phaseLabel(snapshot.phase) + " 단계";
  $("turnDot").className = "status-dot " + (snapshot.finished ? "" : humanTurn ? "online" : "waiting");
  $("humanTurnBadge").hidden = !humanTurn || snapshot.finished;
  $("opponentTurnBadge").hidden = humanTurn || snapshot.finished;
  $("turnCounter").textContent = "TURN " + snapshot.turnNumber;
  $("battleStatus").textContent = snapshot.finished
    ? (snapshot.winnerSeat === -1 ? "무승부입니다." : snapshot.winnerSeat === 0 ? "승리했습니다!" : "패배했습니다.")
    : snapshot.pendingChoice && snapshot.pendingChoice.waiting
      ? "상대의 선택을 기다리는 중입니다."
      : humanTurn ? "내 행동을 선택하세요." : "AI가 MCP 도구로 행동을 진행합니다.";
  $("humanHandCount").textContent = "패 " + human.handCount;
  $("humanDeckCount").textContent = "덱 " + human.deckCount;
  $("humanKeyCount").textContent = "키 덱 " + human.keyDeckCount;
  $("opponentHandCount").textContent = "패 " + ai.handCount;
  $("opponentDeckCount").textContent = "덱 " + ai.deckCount;
  $("opponentKeyCount").textContent = "키 덱 " + ai.keyDeckCount;

  const phases = ["deploy", "attack", "end"];
  const phaseTrack = $("phaseTrack");
  phaseTrack.replaceChildren();
  for (const phase of phases) {
    const chip = document.createElement("span");
    chip.className = "phase-chip" + (phase === snapshot.phase ? " active" : "");
    chip.textContent = phaseLabel(phase);
    phaseTrack.append(chip);
  }

  renderHand($("opponentHand"), ai, true);
  renderField($("opponentField"), ai.field, "상대 몬스터 존");
  renderMinorZone($("opponentGrave"), "상대 묘지 · " + ai.grave.length, ai.grave, "묘지");
  renderField($("humanField"), human.field, "내 몬스터 존");
  renderMinorZone($("humanGrave"), "내 묘지 · " + human.grave.length, human.grave, "묘지");
  renderMinorZone($("humanKeyDeck"), "키 카드 덱 · " + human.keyDeckCount, human.keyDeck, "키 카드 덱", true);
  renderHand($("humanHand"), human, false);
  renderActions(snapshot);
  renderChoice(snapshot.pendingChoice);
  if (snapshot.finished) {
    setConnection("대전 종료", "online");
  }
}

function renderActions(snapshot) {
  const container = $("humanActions");
  container.replaceChildren();
  if (snapshot.finished) {
    container.textContent = "대전이 끝났습니다.";
    return;
  }
  if (snapshot.pendingChoice) {
    container.textContent = snapshot.pendingChoice.waiting ? "상대가 선택 중입니다." : "선택 창을 먼저 완료하세요.";
    return;
  }
  if (snapshot.turnSeat !== 0) {
    container.textContent = "AI 차례입니다. GPT/Claude의 대전 응답을 기다리세요.";
    return;
  }
  const actions = selectedUid
    ? snapshot.actions.filter((action) => action.type === "next_phase" || action.uid === selectedUid || action.targetUid === selectedUid)
    : snapshot.actions.filter((action) => action.type === "next_phase");
  if (!actions.length) {
    const hint = document.createElement("p");
    hint.className = "muted-copy";
    hint.textContent = selectedUid ? "이 카드로 지금 할 수 있는 행동이 없습니다." : "패 또는 필드의 카드를 선택하세요.";
    container.append(hint);
    return;
  }
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button action-button";
    button.textContent = action.label;
    button.addEventListener("click", () => sendHumanAction(action));
    container.append(button);
  }
}

function renderChoice(prompt) {
  const card = $("choiceCard");
  selectedChoiceValues.clear();
  if (!prompt) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("choiceTitle").textContent = prompt.waiting ? "상대가 선택을 진행하고 있습니다." : prompt.title;
  const options = $("choiceOptions");
  options.replaceChildren();
  if (prompt.waiting) {
    $("submitChoiceButton").hidden = true;
    return;
  }
  $("submitChoiceButton").hidden = false;
  const single = prompt.kind === "respond" || prompt.kind === "confirm" || prompt.kind === "again" || prompt.inputKind === "number";
  for (const option of prompt.options) {
    const label = document.createElement("label");
    label.className = "choice-option";
    const input = document.createElement("input");
    input.type = single ? "radio" : "checkbox";
    input.name = "pending-choice";
    input.value = option.value;
    input.addEventListener("change", () => {
      if (single) selectedChoiceValues.clear();
      if (input.checked) selectedChoiceValues.add(option.value);
      else selectedChoiceValues.delete(option.value);
      $("submitChoiceButton").disabled = !validChoice(prompt, selectedChoiceValues);
    });
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    options.append(label);
  }
  $("submitChoiceButton").disabled = true;
}

function validChoice(prompt, values) {
  if (prompt.kind === "respond" || prompt.kind === "confirm" || prompt.kind === "again" || prompt.inputKind === "number") return values.size === 1;
  return values.size >= (prompt.min ?? 1) && values.size <= (prompt.max ?? prompt.options.length);
}

async function sendHumanAction(action) {
  try {
    setMessage($("duelMessage"), "행동을 처리하고 있습니다…", "");
    const command = { ...action };
    delete command.label;
    await requestJson("/api/games/" + encodeURIComponent(gameCode) + "/action", {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    selectedUid = null;
    setMessage($("duelMessage"), "", "");
    await refreshGame(true);
  } catch (error) {
    setMessage($("duelMessage"), error.message, "error");
  }
}

async function sendHumanChoice() {
  const prompt = latestSnapshot && latestSnapshot.pendingChoice;
  if (!prompt || prompt.waiting || !validChoice(prompt, selectedChoiceValues)) return;
  try {
    const values = Array.from(selectedChoiceValues);
    setMessage($("duelMessage"), "선택을 처리하고 있습니다…", "");
    await requestJson("/api/games/" + encodeURIComponent(gameCode) + "/action", {
      method: "POST",
      body: JSON.stringify({ command: { type: "choice", values } }),
    });
    setMessage($("duelMessage"), "", "");
    await refreshGame(true);
  } catch (error) {
    setMessage($("duelMessage"), error.message, "error");
  }
}

async function applyAiMove() {
  const raw = $("manualAiInput").value.trim();
  if (!raw) {
    setMessage($("duelMessage"), "GPT가 응답한 actionId 또는 choice_values를 넣어 주세요.", "error");
    return;
  }
  try {
    let body;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      body = {
        action_id: parsed.action_id ?? parsed.actionId,
        choice_values: parsed.choice_values ?? parsed.choiceValues,
      };
    } else if (raw.startsWith("[")) {
      body = { choice_values: JSON.parse(raw) };
    } else {
      body = { action_id: raw };
    }
    setMessage($("duelMessage"), "AI 행동을 적용하고 있습니다…", "");
    await requestJson("/api/games/" + encodeURIComponent(gameCode) + "/ai-action", {
      method: "POST",
      body: JSON.stringify(body),
    });
    $("manualAiInput").value = "";
    setMessage($("duelMessage"), "", "");
    await refreshGame(true);
  } catch (error) {
    setMessage($("duelMessage"), error.message, "error");
  }
}

function connectionPrompt() {
  return [
    "Hand Battle 대전에 참가해 줘. 너는 AI 플레이어 B이고 나는 사이트에서 플레이하는 플레이어 A야.",
    "MCP 서버 주소: " + apiBaseUrl + "/mcp",
    "대전 코드: " + gameCode,
    "get_game_rules로 규칙을 읽고, get_duel_state로 현재 상태를 확인해.",
    "네 차례에는 get_legal_actions가 돌려준 action_id만 골라 duel_action으로 행동 하나씩 실행해. 선택 창이 나오면 choice_values로 응답해.",
    "합법 행동을 만들거나 추측하지 말고, 다른 플레이어의 비공개 패를 알아내려 하지 마. 내 차례가 되면 행동을 멈추고 결과를 알려 줘.",
    "만약 duel_action 도구를 사용할 수 없다면 get_legal_actions 결과에서 고른 action_id만 답해. 선택 창이면 JSON 형식 {\"choice_values\":[\"값\"]}으로 답하고 내가 사이트에서 적용할게.",
  ].join("\n");
}

async function copyConnectionPrompt() {
  try {
    await navigator.clipboard.writeText(connectionPrompt());
    $("copyPromptButton").textContent = "복사 완료";
    setTimeout(() => { $("copyPromptButton").textContent = "AI 연결 안내 복사"; }, 1600);
  } catch {
    setMessage($("duelMessage"), connectionPrompt(), "");
  }
}

function newGame() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  sessionStorage.removeItem("hand-battle-ai-game");
  sessionStorage.removeItem("hand-battle-ai-provider");
  gameCode = null;
  latestSnapshot = null;
  selectedUid = null;
  setupView.hidden = false;
  duelView.hidden = true;
  setMessage($("setupMessage"), "새 덱을 가져와 다음 대전을 시작하세요.", "");
}

$("providerSelect").addEventListener("change", () => {
  const provider = $("providerSelect").value;
  if (!$("aiNameInput").value.trim() || ["ChatGPT", "Claude"].includes($("aiNameInput").value.trim())) {
    $("aiNameInput").value = provider;
  }
});
$("apiBaseInput").addEventListener("change", () => {
  try { currentApiBase(); loadCatalog(); } catch (error) { setMessage($("setupMessage"), error.message, "error"); }
});
$("downloadTemplateButton").addEventListener("click", () => {
  let deckToSave = { name: "AI 덱", main: [], key: [] };
  if ($("aiDeckInput").value.trim()) {
    if (!inspectDeck()) return;
    deckToSave = aiDeck;
  }
  const blob = new Blob([JSON.stringify(deckToSave, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hand-battle-ai-deck-template.json";
  anchor.click();
  URL.revokeObjectURL(url);
});
$("deckFileInput").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    $("aiDeckInput").value = JSON.stringify(normalizeDeckFile(value), null, 2);
    inspectDeck();
  } catch (error) {
    aiDeck = null;
    setMessage($("deckMessage"), error.message, "error");
  }
});
$("validateDeckButton").addEventListener("click", () => inspectDeck());
$("startButton").addEventListener("click", startGame);
$("submitChoiceButton").addEventListener("click", sendHumanChoice);
$("applyAiMoveButton").addEventListener("click", applyAiMove);
$("manualAiInput").addEventListener("keydown", (event) => { if (event.key === "Enter") applyAiMove(); });
$("copyPromptButton").addEventListener("click", copyConnectionPrompt);
$("newGameButton").addEventListener("click", newGame);

loadCatalog();
