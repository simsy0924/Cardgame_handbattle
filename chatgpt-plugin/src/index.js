import { tools, upstreamNames } from './tools.mjs';

const MCP_UPSTREAM = 'https://hand-battle-ai-mcp.onrender.com/mcp';
// Newest first. ChatGPT negotiates 2026-07-28 / 2026-01-26 / 2025-11-25; older clients still use the 2025 and 2024 versions.
// A stateless tools-only server is compatible with all of them, so an unknown version falls back to the newest one here.
export const SUPPORTED_VERSIONS = ['2026-07-28', '2026-01-26', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export function negotiateProtocolVersion(requested) {
  return SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
}
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
function toolError(id, code, message) {
  return json(200, { jsonrpc: '2.0', id, result: {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { error: { code, message } },
  } });
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
    try {
      // Never forward OAuth credentials or identity. Never retry an action.
      const upstream = await fetch(new Request(MCP_UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: upstreamName, arguments: args } }),
        redirect: 'error', signal: AbortSignal.timeout(45000),
      }));
      if (!upstream.ok) return toolError(id, 'upstream_http_error', `Hand Battle 서버가 HTTP ${upstream.status} 오류를 반환했습니다.`);
      const reply = await upstream.json();
      if (reply?.jsonrpc !== '2.0' || reply.id !== id || (!Object.hasOwn(reply, 'result') && !Object.hasOwn(reply, 'error'))) {
        return toolError(id, 'invalid_upstream_response', 'Hand Battle 서버 응답 형식을 확인할 수 없습니다.');
      }
      return json(200, reply);
    } catch {
      return toolError(id, 'upstream_unavailable', 'Hand Battle 서버에 연결하지 못했습니다. 상태를 다시 확인하세요. 행동이 처리됐을 수 있으므로 같은 행동을 바로 재시도하지 마세요.');
    }
  },
};
