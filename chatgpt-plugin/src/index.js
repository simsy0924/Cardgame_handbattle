import { tools, upstreamNames } from './tools.mjs';

const MCP_UPSTREAM = 'https://hand-battle-ai-mcp.onrender.com/mcp';
// Newest first. ChatGPT negotiates 2026-07-28 / 2026-01-26 / 2025-11-25; older clients still use the 2025 and 2024 versions.
// A stateless tools-only server is compatible with all of them, so an unknown version falls back to the newest one here.
export const SUPPORTED_VERSIONS = ['2026-07-28', '2026-01-26', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export function negotiateProtocolVersion(requested) {
  return SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
}
const UPSTREAM_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 1024 * 1024;

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
function rpcError(id, code, message, status = 200) {
  return json(status, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}
function toolError(id, code, message, diagnostic) {
  return json(200, { jsonrpc: '2.0', id, result: {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { error: { code, message, ...(diagnostic ? { diagnostic } : {}) } },
  } });
}
function safeDiagnosticText(value) {
  if (typeof value !== 'string') return undefined;
  return value.replace(/[\\r\\n\\t]+/g, ' ').slice(0, 180);
}
function describeError(error) {
  const diagnostic = {};
  const name = safeDiagnosticText(error?.name);
  const message = safeDiagnosticText(error?.message);
  if (name) diagnostic.name = name;
  if (message) diagnostic.message = message;
  const cause = error?.cause;
  if (cause && typeof cause === 'object') {
    const causeName = safeDiagnosticText(cause.name);
    const causeMessage = safeDiagnosticText(cause.message);
    const causeCode = typeof cause.code === 'string' || typeof cause.code === 'number'
      ? safeDiagnosticText(String(cause.code))
      : undefined;
    if (causeName) diagnostic.causeName = causeName;
    if (causeCode) diagnostic.causeCode = causeCode;
    if (causeMessage) diagnostic.causeMessage = causeMessage;
  }
  if (!Object.keys(diagnostic).length) return { name: 'Error', message: 'Unknown upstream failure' };
  return diagnostic;
}
function diagnosticText(diagnostic) {
  return [diagnostic.causeCode, diagnostic.causeMessage, diagnostic.name, diagnostic.message]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(': ')
    .slice(0, 240);
}
function logUpstreamError(stage, toolName, diagnostic) {
  // Do not log tool arguments, game codes, identity headers, or credentials.
  console.error(JSON.stringify({ event: 'hand_battle_upstream_error', stage, tool: toolName, ...diagnostic }));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return json(200, { ok: true, service: 'hand-battle-gpt-mcp', version: '2.1.0' });
    }
    if (url.pathname !== '/mcp') return json(404, { error: 'not_found' });
    if (request.method !== 'POST') return new Response('MCP requests must use POST.', {
      status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' },
    });
    let message;
    try {
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY_BYTES) return rpcError(null, -32600, 'Request too large', 413);
      message = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return rpcError(null, -32700, 'Parse error', 400);
    }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0') {
      return rpcError(message?.id, -32600, 'Invalid Request', 400);
    }
    // Notifications and client responses (to a server request) carry no reply body: 202 per Streamable HTTP.
    if (typeof message.method !== 'string') {
      return Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')
        ? new Response(null, { status: 202 })
        : rpcError(message.id, -32600, 'Invalid Request', 400);
    }
    const id = message.id;
    if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
    const result = value => json(200, { jsonrpc: '2.0', id, result: value });

    // Discovery is local and independent of Render startup time or game state.
    if (message.method === 'initialize') return result({
      protocolVersion: negotiateProtocolVersion(message.params?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'hand-battle-ai-duel-plugin', version: '2.1.0' },
      instructions: 'Hand Battle 전용입니다. 앱의 32자리 코드를 game_code로 전달하세요. AI는 플레이어 B입니다. hand_battle_get_game_rules와 hand_battle_get_card_catalog로 규칙과 효과를 확인하고, hand_battle_get_duel_state와 hand_battle_get_legal_actions를 읽어 합법 행동 하나씩 실행하세요. 유희왕 전개 검증기의 pairingCode 도구를 사용하지 마세요. 상대 차례이면 행동을 실행하지 말고 기다리세요.',
    });
    if (message.method === 'ping') return result({});
    if (message.method === 'tools/list') return result({ tools });
    if (message.method !== 'tools/call') return rpcError(id, -32601, 'Method not found');

    const upstreamName = upstreamNames.get(message.params?.name);
    if (!upstreamName) return rpcError(id, -32602, 'Unknown Hand Battle tool');
    // Sites supplies this trusted identity after its OAuth and access checks.
    if (!request.headers.get('oai-authenticated-user-id')) {
      return rpcError(id, -32001, 'Sign in to the Hand Battle plugin before using duel tools.', 401);
    }
    const args = message.params?.arguments ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'Invalid tool arguments');
    if (['get_duel_state', 'get_legal_actions', 'duel_action'].includes(upstreamName) &&
        (typeof args.game_code !== 'string' || !/^[A-Fa-f0-9]{32}$/.test(args.game_code))) {
      return toolError(id, 'invalid_game_code', '앱에서 받은 32자리 대전 코드를 game_code로 전달하세요.');
    }
    // A free Render instance can need about a minute to wake after idle. Use a
    // portable AbortController timeout instead of AbortSignal.timeout(), which
    // is not implemented consistently by all Worker runtimes.
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPSTREAM_TIMEOUT_MS);
    try {
      // Never forward OAuth credentials or identity. Never retry an action.
      let upstream;
      try {
        upstream = await fetch(new Request(MCP_UPSTREAM, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: upstreamName, arguments: args } }),
          // Cloudflare Workers support only "follow" and "manual". Manual
          // keeps the request on the configured upstream instead of following
          // redirects to an unexpected host.
          redirect: 'manual', signal: controller.signal,
        }));
      } catch (error) {
        const diagnostic = describeError(error);
        logUpstreamError(timedOut ? 'timeout' : 'fetch', upstreamName, { ...diagnostic, timedOut });
        const code = timedOut ? 'upstream_timeout' : 'upstream_unavailable';
        const detail = diagnosticText(diagnostic);
        const message = timedOut
          ? `Hand Battle 서버가 ${UPSTREAM_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다.${upstreamName === 'duel_action' ? ' 행동 결과를 확인할 수 없어 재전송하지 않았습니다. 먼저 대전 상태를 확인하세요.' : ''}`
          : `Hand Battle 서버 연결에 실패했습니다 (${detail}).${upstreamName === 'duel_action' ? ' 행동 결과를 확인할 수 없어 재전송하지 않았습니다. 먼저 대전 상태를 확인하세요.' : ''}`;
        return toolError(id, code, message, diagnostic);
      }
      if (!upstream.ok) return toolError(id, 'upstream_http_error', `Hand Battle 서버가 HTTP ${upstream.status} 오류를 반환했습니다.`);
      let reply;
      try {
        reply = await upstream.json();
      } catch (error) {
        const diagnostic = describeError(error);
        logUpstreamError('response_json', upstreamName, { ...diagnostic, contentType: upstream.headers.get('content-type') || 'unknown' });
        return toolError(id, 'invalid_upstream_response', `Hand Battle 서버가 읽을 수 없는 응답을 반환했습니다 (${diagnosticText(diagnostic)}).`, diagnostic);
      }
      if (reply?.jsonrpc !== '2.0' || reply.id !== id || (!Object.hasOwn(reply, 'result') && !Object.hasOwn(reply, 'error'))) {
        return toolError(id, 'invalid_upstream_response', 'Hand Battle 서버 응답 형식을 확인할 수 없습니다.');
      }
      return json(200, reply);
    } finally {
      clearTimeout(timeout);
    }
  },
};
