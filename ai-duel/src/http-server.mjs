import { createServer } from "node:http";
import { MatchError } from "./game-store.mjs";

const MAX_BODY_BYTES = 1024 * 1024;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new MatchError("body_too_large", "요청이 너무 큽니다.", 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MatchError("invalid_json", "JSON 형식을 확인하세요.", 400);
  }
}

function allowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return new Set(env.split(",").map((origin) => origin.trim()).filter(Boolean));
  return new Set([
    "https://simsy0924.github.io",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
  ]);
}

function setCommonHeaders(req, res, origins) {
  const origin = req.headers.origin;
  if (origin && origins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function textResult(value, { isError = false } = {}) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(typeof value === "object" && value !== null ? { structuredContent: value } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

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

function toolCall(store, name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new MatchError("invalid_arguments", "도구 입력 형식을 확인하세요.");
  }
  switch (name) {
    case "get_duel_state":
      return store.getState(args.game_code, 1);
    case "get_legal_actions":
      return store.getLegalActions(args.game_code);
    case "get_card_catalog": {
      const cards = store.getCatalog();
      const requested = args.card_ids;
      if (requested === undefined) return { cards };
      if (!Array.isArray(requested) || requested.length > 100 || requested.some((id) => typeof id !== "string")) {
        throw new MatchError("invalid_arguments", "card_ids는 문자열 목록이어야 합니다.");
      }
      const ids = new Set(requested);
      return { cards: cards.filter((card) => ids.has(card.id)) };
    }
    case "get_game_rules":
      return { rules: store.getRules() };
    case "duel_action": {
      const updated = store.applyAiAction(args.game_code, {
        actionId: args.action_id,
        choiceValues: args.choice_values,
      });
      return {
        message: "AI 행동을 처리했습니다. 사용자에게 선택을 요청하는 중이면 앱에서 상태를 확인하세요.",
        state: updated,
      };
    }
    default:
      throw new MatchError("unknown_tool", "알 수 없는 MCP 도구입니다.", 404);
  }
}

export function dispatchApiRequest({ store, method, pathname, body = {} }) {
  if (method === "GET" && pathname === "/api/cards") {
    return { status: 200, body: { cards: store.getCatalog() } };
  }
  if (method === "POST" && pathname === "/api/games") {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new MatchError("invalid_input", "대전 설정 JSON 객체를 전달하세요.");
    }
    return {
      status: 201,
      body: store.create({
        humanDeck: body.human_deck,
        aiDeck: body.ai_deck,
        aiName: body.ai_name,
      }),
    };
  }
  const gameMatch = pathname.match(/^\/api\/games\/([A-Fa-f0-9]{32})(?:\/(state|action|ai-action))?$/);
  if (!gameMatch) return null;
  const code = gameMatch[1].toUpperCase();
  const route = gameMatch[2] || "state";
  if (route === "state" && method === "GET") return { status: 200, body: store.getState(code, 0) };
  if (route === "action" && method === "POST") {
    if (!body || typeof body !== "object") throw new MatchError("invalid_input", "행동 JSON 객체를 전달하세요.");
    return { status: 200, body: store.applyHumanCommand(code, body.command) };
  }
  if (route === "ai-action" && method === "POST") {
    if (!body || typeof body !== "object") throw new MatchError("invalid_input", "AI 행동 JSON 객체를 전달하세요.");
    return {
      status: 200,
      body: store.applyAiAction(code, { actionId: body.action_id, choiceValues: body.choice_values }),
    };
  }
  return null;
}

export function handleMcpMessage(store, message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { httpStatus: 400, body: { jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32600, message: "Invalid Request" } } };
  }

  const id = Object.hasOwn(message, "id") ? message.id : undefined;
  const request = (result) => ({ httpStatus: 200, body: { jsonrpc: "2.0", id, result } });

  if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) {
    return { httpStatus: 202, body: null };
  }
  if (id === undefined) return { httpStatus: 202, body: null };

  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    const supported = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
    return request({
      protocolVersion: supported.has(requestedVersion) ? requestedVersion : "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "hand-battle-ai-duel", version: "1.0.0" },
      instructions: "게임 코드를 가진 AI는 플레이어 B입니다. 상태와 합법 행동을 확인한 뒤 행동 하나씩 처리하세요. 외부 카드 규칙을 추측하지 말고 get_card_catalog의 텍스트를 따르세요.",
    });
  }

  if (message.method === "ping") return request({});
  if (message.method === "tools/list") return request({ tools: TOOLS });

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    try {
      return request(textResult(toolCall(store, name, args)));
    } catch (error) {
      const normalized = error instanceof MatchError
        ? error
        : new MatchError("tool_failed", error?.message || "도구를 실행하지 못했습니다.", 500);
      return request({
        ...textResult(normalized.message, { isError: true }),
        structuredContent: { error: { code: normalized.code, message: normalized.message } },
      });
    }
  }

  return {
    httpStatus: 200,
    body: {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    },
  };
}

export function createHttpServer({ store, origins = allowedOrigins() }) {
  return createServer(async (req, res) => {
    setCommonHeaders(req, res, origins);
    const requestUrl = new URL(req.url || "/", "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestUrl.pathname === "/mcp") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        json(res, 405, { error: "MCP Streamable HTTP는 POST 요청을 사용합니다." });
        return;
      }
      try {
        const message = await readJson(req);
        const handled = handleMcpMessage(store, message);
        if (!handled.body) {
          res.writeHead(handled.httpStatus, { "Cache-Control": "no-store" });
          res.end();
        } else {
          json(res, handled.httpStatus, handled.body);
        }
      } catch (error) {
        const status = error instanceof MatchError ? error.status : 400;
        json(res, status, { error: { code: error.code || "invalid_request", message: error.message || "요청을 처리하지 못했습니다." } });
      }
      return;
    }

    if (requestUrl.pathname === "/health") {
      json(res, 200, { ok: true, service: "hand-battle-ai-duel" });
      return;
    }

    try {
      if (requestUrl.pathname.startsWith("/api/")) {
        const body = req.method === "POST" ? await readJson(req) : {};
        const routed = dispatchApiRequest({ store, method: req.method, pathname: requestUrl.pathname, body });
        if (routed) {
          json(res, routed.status, routed.body);
          return;
        }
      }
      json(res, 404, { error: { code: "not_found", message: "요청한 경로를 찾을 수 없습니다." } });
    } catch (error) {
      const status = error instanceof MatchError ? error.status : 400;
      json(res, status, { error: { code: error.code || "request_failed", message: error.message || "요청을 처리하지 못했습니다." } });
    }
  });
}
