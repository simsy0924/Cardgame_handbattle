const GAME_CODE_SCHEMA = {
  type: "string",
  description: "앱에서 AI 대전을 시작한 뒤 받은 32자리 대전 코드",
  minLength: 32,
  maxLength: 32,
};

const TOOLS = [
  {
    name: "get_duel_state",
    title: "대전 상태 확인",
    description: "현재 대전 상태를 AI 플레이어(B)의 시점에서 읽습니다. 사람 플레이어의 비공개 패는 포함하지 않습니다.",
    inputSchema: { type: "object", properties: { game_code: GAME_CODE_SCHEMA }, required: ["game_code"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_legal_actions",
    title: "합법 행동 확인",
    description: "AI 플레이어가 지금 선택할 수 있는 서버 검증 행동과 action_id를 읽습니다. 선택 처리가 필요한 경우 선택지를 함께 반환합니다.",
    inputSchema: { type: "object", properties: { game_code: GAME_CODE_SCHEMA }, required: ["game_code"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_card_catalog",
    title: "카드 효과 보기",
    description: "게임에서 사용할 수 있는 카드 이름과 효과 텍스트를 읽습니다. 필요한 카드 ID만 요청할 수 있습니다.",
    inputSchema: {
      type: "object",
      properties: {
        card_ids: { type: "array", items: { type: "string" }, maxItems: 100, description: "원하는 카드 ID. 생략하면 전체 카드 목록을 반환합니다." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_game_rules",
    title: "게임 규칙 보기",
    description: "게임의 턴, 승리 조건, 덱 제한을 읽습니다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "duel_action",
    title: "AI 행동 실행",
    description: "AI 플레이어(B)의 현재 합법 행동 하나를 실행하거나, AI에게 열린 선택 창에 응답합니다. 먼저 get_legal_actions를 불러 action_id 또는 choice_values를 확인하세요.",
    inputSchema: {
      type: "object",
      properties: {
        game_code: GAME_CODE_SCHEMA,
        action_id: { type: "string", description: "get_legal_actions가 반환한 action_id. 일반 게임 행동에 사용합니다." },
        choice_values: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "진행 중인 선택 창의 value 목록. 선택지를 고를 때 사용합니다." },
      },
      required: ["game_code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];


// Preserve the GitHub/Render schemas; namespace only the published tool names.
export const tools = TOOLS.map(tool => ({ ...tool, name: `hand_battle_${tool.name}` }));
export const upstreamNames = new Map(tools.map(tool => [tool.name, tool.name.slice('hand_battle_'.length)]));

