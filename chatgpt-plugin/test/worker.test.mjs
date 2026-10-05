import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';
import { tools } from '../src/tools.mjs';

const code = 'A'.repeat(32);
const rpc = (method, params, authenticated = true) => new Request('https://site.example/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { 'oai-authenticated-user-id': 'test-user', authorization: 'Bearer secret', cookie: 'private' } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});
async function withFetch(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await fn(); } finally { globalThis.fetch = original; }
}

test('initialization, discovery and notifications work without contacting Render', async () => {
  await withFetch(() => { throw new Error('must not contact Render'); }, async () => {
    const init = await (await worker.fetch(rpc('initialize', { protocolVersion: '2025-06-18' }, false))).json();
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.version, '2.0.0');
    const list = await (await worker.fetch(rpc('tools/list', {}, false))).json();
    assert.deepEqual(list.result.tools.map(t => t.name), ['hand_battle_get_duel_state', 'hand_battle_get_legal_actions', 'hand_battle_get_card_catalog', 'hand_battle_get_game_rules', 'hand_battle_duel_action']);
    assert.deepEqual(list.result.tools[0].inputSchema.required, ['game_code']);
    assert.equal(list.result.tools[0].inputSchema.properties.pairingCode, undefined);
    const notification = await worker.fetch(new Request('https://site.example/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }));
    assert.equal(notification.status, 202);
  });
});

test('each namespaced tool forwards the canonical name, arguments and reply without credentials', async () => {
  for (const tool of tools) {
    const args = tool.name.endsWith('duel_action') ? { game_code: code, action_id: 'end-turn' } : tool.name.endsWith('get_card_catalog') ? { card_ids: ['p1'] } : tool.name.endsWith('get_game_rules') ? {} : { game_code: code };
    let calls = 0;
    await withFetch(async request => {
      calls++;
      assert.equal(request.url, 'https://hand-battle-ai-mcp.onrender.com/mcp');
      for (const h of ['authorization', 'cookie', 'oai-authenticated-user-id']) assert.equal(request.headers.has(h), false);
      const body = await request.json();
      assert.equal(body.params.name, tool.name.slice('hand_battle_'.length));
      assert.deepEqual(body.params.arguments, args);
      return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { revision: 2 } } });
    }, async () => {
      const reply = await (await worker.fetch(rpc('tools/call', { name: tool.name, arguments: args }))).json();
      assert.equal(reply.result.structuredContent.revision, 2);
      assert.equal(calls, 1);
    });
  }
});

test('unauthenticated calls, wrong tool names and pairingCode never reach Render', async () => {
  await withFetch(() => { throw new Error('must not contact Render'); }, async () => {
    const unauth = await worker.fetch(rpc('tools/call', { name: 'hand_battle_get_game_rules' }, false));
    assert.equal(unauth.status, 401);
    const wrong = await (await worker.fetch(rpc('tools/call', { name: 'get_duel_state', arguments: { pairingCode: code } }))).json();
    assert.equal(wrong.error.code, -32602);
    const badCode = await (await worker.fetch(rpc('tools/call', { name: 'hand_battle_get_duel_state', arguments: { pairingCode: code } }))).json();
    assert.equal(badCode.result.structuredContent.error.code, 'invalid_game_code');
  });
});

test('backend game errors are preserved', async () => {
  const result = { isError: true, content: [{ type: 'text', text: 'expired' }], structuredContent: { error: { code: 'game_not_found', message: 'expired' } } };
  await withFetch(async () => Response.json({ jsonrpc: '2.0', id: 1, result }), async () => {
    const reply = await (await worker.fetch(rpc('tools/call', { name: 'hand_battle_get_duel_state', arguments: { game_code: code } }))).json();
    assert.deepEqual(reply.result, result);
  });
});

test('network failures do not retry actions or invent successful results', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error('network'); }, async () => {
    const reply = await (await worker.fetch(rpc('tools/call', { name: 'hand_battle_duel_action', arguments: { game_code: code, action_id: 'end-turn' } }))).json();
    assert.equal(reply.result.isError, true);
    assert.equal(reply.result.structuredContent.error.code, 'upstream_unavailable');
    assert.equal(calls, 1);
  });
});

test('HTTP errors and non-MCP replies remain explicit tool errors', async () => {
  for (const response of [new Response('bad gateway', { status: 502 }), Response.json({ ok: true }), Response.json({ jsonrpc: '2.0', id: 9, result: {} })]) {
    await withFetch(async () => response, async () => {
      const reply = await (await worker.fetch(rpc('tools/call', { name: 'hand_battle_get_game_rules' }))).json();
      assert.equal(reply.result.isError, true);
    });
  }
});

test('malformed JSON and unsupported routes never contact the backend', async () => {
  await withFetch(() => { throw new Error('must not contact Render'); }, async () => {
    assert.equal((await worker.fetch(new Request('https://site.example/mcp'))).status, 405);
    assert.equal((await worker.fetch(new Request('https://site.example/other'))).status, 404);
    assert.equal((await worker.fetch(new Request('https://site.example/mcp', { method: 'POST', body: '{' }))).status, 400);
    assert.equal((await worker.fetch(new Request('https://site.example/mcp', { method: 'POST', body: 'null' }))).status, 400);
    const health = await (await worker.fetch(new Request('https://site.example/health'))).json();
    assert.equal(health.version, '2.0.0');
  });
});
