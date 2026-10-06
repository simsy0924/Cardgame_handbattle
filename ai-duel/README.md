# Hand Battle AI Duel

AI duels are played in the Android app. The app sends the match state to the Render game API, while GPT or Claude plays as seat B through MCP tools. The game server validates each move; no OpenAI or Anthropic API key is stored by the game.

## Play from Android

1. Open **AI 대전** in Hand Battle.
2. Import the AI deck JSON file and choose GPT or Claude.
3. Start the match, then copy the game code from the game screen and paste it into the connected GPT or Claude conversation. The AI reads the rules from the tools' own descriptions.
4. Make your moves in the Android app. The app refreshes the board while the model uses MCP tools.

Prepare the AI deck separately. It can list physical card IDs or counts:

~~~json
{
  "name": "AI deck",
  "main": [
    { "id": "penguin_001", "count": 4 },
    { "id": "penguin_003", "count": 4 }
  ],
  "key": ["penguin_008"]
}
~~~

The app accepts main and key arrays or count objects, including nested deck objects. The main deck must contain 40–60 cards, with at most four copies of each main card. The key card deck allows at most ten cards, one copy of each key card.

## Run locally

~~~sh
cd ai-duel
npm test
npm start
~~~

The game API is available on the configured port. /mcp exposes the Streamable HTTP MCP endpoint used by GPT and Claude; /health is the health check. The service does not provide a player-facing game page.

## Deploy

- render.yaml defines the Node service hand-battle-ai-mcp and its /mcp endpoint.
- app/build.gradle.kts points the Android app at https://hand-battle-ai-mcp.onrender.com. Change AI_DUEL_SERVER_URL there if the Render service URL changes.
- Games are stored in memory, use a random 32-character connection code, and expire after six hours without activity. Restarting or replacing the service clears its active games. Keep the connection code private; it grants access to that match.

## MCP tools

In ChatGPT, install the Hand Battle AI Duel plugin hosted on ChatGPT Sites (see [`chatgpt-plugin/`](../chatgpt-plugin/)); it publishes the tools below with the `hand_battle_` prefix. Paste the game code copied from the app into the conversation. In Claude, connect an MCP server at https://hand-battle-ai-mcp.onrender.com/mcp, which exposes the canonical names below. The endpoint negotiates MCP protocol versions 2024-11-05 through 2026-07-28 and answers an unknown version with the newest supported one.

| Tool | Access | Purpose |
| --- | --- | --- |
| get_game_rules | Read | Read the duel rules and deck limits. |
| get_card_catalog | Read | Read card names and official effect text. |
| get_duel_state | Read | Inspect the match as seat B; seat A's unrevealed hand stays hidden. |
| get_recent_events | Read | Read recent events, optionally starting after an event ID. |
| get_legal_actions | Read | Get the current legal AI actions, chain context, or an open choice prompt. |
| wait_for_action | Read | Wait up to 30 seconds for seat B's turn or a response prompt. |
| duel_action | Write | Apply one current legal AI action or submit the AI's choice; returns a compact state delta. |

State snapshots include card IDs and names, current chain links, a recent event log, and the current turn owner. Card descriptions are read through `get_card_catalog` instead of being repeated in every state response. Action IDs are tied to the current match revision. If the board changes, request legal actions again. The human makes moves in the Android app.
