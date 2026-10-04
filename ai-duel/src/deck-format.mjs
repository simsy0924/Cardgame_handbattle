function expandList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) && typeof value === "object") {
    return Object.entries(value).flatMap(([id, count]) => {
      const copies = Number(count);
      if (!Number.isInteger(copies) || copies < 0 || copies > 60) {
        throw new Error(label + "의 매수는 0~60 사이 정수여야 합니다. (" + id + ")");
      }
      return Array(copies).fill(id);
    });
  }
  if (!Array.isArray(value)) throw new Error(label + "은 카드 ID 배열 또는 매수 객체여야 합니다.");

  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(label + " 항목은 카드 ID 문자열 또는 {id, count} 객체여야 합니다.");
    }
    const id = entry.id ?? entry.cardId ?? entry.card_id;
    const copies = entry.count === undefined ? 1 : Number(entry.count);
    if (typeof id !== "string" || !id) throw new Error(label + " 항목의 id가 없습니다.");
    if (!Number.isInteger(copies) || copies < 0 || copies > 60) {
      throw new Error(label + "의 매수는 0~60 사이 정수여야 합니다. (" + id + ")");
    }
    return Array(copies).fill(id);
  });
}

export function normalizeDeckFile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("덱 파일은 JSON 객체여야 합니다.");
  }
  const nested = value.deck && typeof value.deck === "object" ? value.deck : value;
  const mainValue = nested.main ?? nested.mainDeck ?? nested.main_deck;
  const keyValue = nested.key ?? nested.keyDeck ?? nested.key_deck;
  if (mainValue === undefined || keyValue === undefined) {
    throw new Error("덱 JSON에 main과 key 목록을 넣어 주세요.");
  }
  const main = expandList(mainValue, "메인 덱");
  const key = expandList(keyValue, "키 카드 덱");
  return {
    name: typeof value.name === "string" ? value.name : "가져온 덱",
    main,
    key,
  };
}

export function validateDeck(deck, catalog) {
  const cards = new Map(catalog.map((card) => [card.id, card]));
  const errors = [];
  if (!deck || !Array.isArray(deck.main) || !Array.isArray(deck.key)) return ["메인 덱과 키 카드 덱을 확인하세요."];
  if (deck.main.length < 40 || deck.main.length > 60) {
    errors.push("메인 덱은 40~60장이어야 합니다. (현재 " + deck.main.length + "장)");
  }
  if (deck.key.length > 10) errors.push("키 카드 덱은 최대 10장까지 넣을 수 있습니다. (현재 " + deck.key.length + "장)");

  const mainCounts = new Map();
  for (const id of deck.main) {
    const card = cards.get(id);
    if (!card || card.deck !== "main") {
      errors.push("메인 덱에 없거나 키 카드인 카드가 있습니다. (" + id + ")");
      continue;
    }
    mainCounts.set(id, (mainCounts.get(id) || 0) + 1);
    if (mainCounts.get(id) > 4) errors.push("메인 덱은 같은 카드를 최대 4장까지 넣을 수 있습니다. (" + card.name + ")");
  }

  const keyIds = new Set();
  for (const id of deck.key) {
    const card = cards.get(id);
    if (!card || card.deck !== "key") {
      errors.push("키 카드 덱에 없거나 메인 카드인 카드가 있습니다. (" + id + ")");
      continue;
    }
    if (keyIds.has(id)) errors.push("키 카드 덱에는 같은 카드를 1장만 넣을 수 있습니다. (" + card.name + ")");
    keyIds.add(id);
  }
  return [...new Set(errors)];
}

