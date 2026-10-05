# Hand Battle AI Duel MCP v2

This owner-private Site provides the ChatGPT plugin for the Android Hand Battle app. It does not use an LLM API. Game state stays on the existing Render server.

The bridge serves MCP initialization and its five tool schemas locally, so discovery is independent of Render startup time. The published names are `hand_battle_get_duel_state`, `hand_battle_get_legal_actions`, `hand_battle_get_card_catalog`, `hand_battle_get_game_rules`, and `hand_battle_duel_action`. The bridge removes only the `hand_battle_` prefix when forwarding to Render. Arguments remain the canonical GitHub schemas, including the 32-character `game_code`, `action_id` and `choice_values`.

Sites manages OAuth and the owner-private access policy. Tool calls require the trusted Site user header. Credentials, cookies and identity headers are never forwarded to Render. Backend game errors are preserved, connection errors are explicit, and actions are never retried automatically.

The schema source is `simsy0924/Cardgame_handbattle/ai-duel/src/http-server.mjs` at commit `df3758fbfd8a976469a42437441276882e8a4561`. Update `src/tools.mjs` whenever that contract changes.

Run `npm test` and `npm run build` before publication. After publication, reconnect the existing Hand Battle AI Duel plugin and open a new chat if older tools remain cached. Verify `hand_battle_get_game_rules` first, then use an app-generated game code to check duel state.
