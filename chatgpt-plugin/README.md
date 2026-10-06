# Hand Battle AI Duel MCP v2.2

This owner-private Site provides the ChatGPT plugin for the Android Hand Battle app. It does not use an LLM API. Game state stays on the existing Render server.

The bridge serves MCP initialization and its seven tool schemas locally, so discovery is independent of Render startup time. It negotiates MCP protocol versions `2026-07-28`, `2026-01-26`, `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`; ChatGPT uses the 2026 versions, and an unknown version is answered with the newest supported one. The published tools include `hand_battle_get_duel_state`, `hand_battle_get_legal_actions`, `hand_battle_get_card_catalog`, `hand_battle_get_recent_events`, `hand_battle_wait_for_action`, `hand_battle_get_game_rules` and `hand_battle_duel_action`. The bridge removes only the `hand_battle_` prefix when forwarding to Render. Arguments remain the canonical GitHub schemas, including the 32-character `game_code`, `action_id`, `choice_values`, event cursor and wait timeout.

Sites manages OAuth and the owner-private access policy. Tool calls require the trusted Site user header. Credentials, cookies and identity headers are never forwarded to Render. Backend game errors are preserved, connection errors are explicit, and actions are never retried automatically.

The canonical schema source is `ai-duel/src/http-server.mjs` in this repository. Keep `src/tools.mjs` aligned whenever that contract changes.

Run `npm test` and `npm run build` before publication. The build inlines `src/tools.mjs` into a single `dist/server/index.js` Worker module (plus `dist/.openai/hosting.json`), because Sites deploys that one entry file. The app copies only the 32-character game code; the server `instructions` returned by `initialize` tell GPT which tools to use. After publication, reconnect the existing Hand Battle AI Duel plugin and open a new chat if older tools remain cached. Verify `hand_battle_get_game_rules` first, then use an app-generated game code to check duel state.
