# Hand Battle AI Duel

The AI duel uses the existing Hand Battle effect engine. You play as seat A in the browser; GPT or Claude plays as seat B through MCP tools. The game server is authoritative and checks every move. No OpenAI or Anthropic API key is used.

## AI deck file

Prepare an AI deck separately, then import its JSON file on the start screen. A match cannot start until a valid AI deck is supplied. The file can list physical card IDs or use counts:

```json
{
  "name": "AI deck",
  "main": [
    { "id": "penguin_001", "count": 4 },
    { "id": "penguin_003", "count": 4 }
  ],
  "key": ["penguin_008"]
}
```

`main` must total 40–60 cards, with at most four copies of each main-deck card. `key` allows at most ten distinct key cards, one copy each. Counts can also be written as an object, for example `"main": {"penguin_001": 4}`. The human player starts with the game's default deck for now. The **JSON 틀 저장** button downloads an empty file structure for preparing the AI deck.

## Run locally

```sh
cd ai-duel
npm test
npm start
```

Open `http://localhost:8787`. The local server also serves the static page and MCP endpoint. A locally running address is not reachable from a hosted ChatGPT/Claude account; deploy the MCP server before connecting those clients.

## Deploy

- `render.yaml` defines the Node service named `hand-battle-ai-mcp`. Creating a Render Blueprint from the repository deploys the game API and the Streamable HTTP MCP endpoint at `/mcp`.
- `.github/workflows/ai-duel-pages.yml` publishes `ai-duel/web/` to GitHub Pages after a push to `main`. Set the repository's Pages source to **GitHub Actions**. The page defaults to `https://hand-battle-ai-mcp.onrender.com` for its API and MCP URL; edit `web/config.js` if the deployed service has a different URL.
- `ALLOWED_ORIGINS` controls which browser origins can call the game API. The Render blueprint includes the project's GitHub Pages origin and localhost development origins.

Games are stored in the running service's memory, use a random 32-character connection code, and expire after six hours without activity. Restarting or replacing the service clears its active games. Keep the connection code private; it grants access to that match.

## MCP tools

Connect the model host to `https://<your-server>/mcp`, start a match on the site, and copy the connection instructions into the GPT/Claude conversation.

| Tool | Access | Purpose |
| --- | --- | --- |
| `get_game_rules` | Read | Read the duel rules and deck limits. |
| `get_card_catalog` | Read | Read card names and official effect text. |
| `get_duel_state` | Read | Inspect the match as seat B; seat A's unrevealed hand stays hidden. |
| `get_legal_actions` | Read | Get the server's current legal actions or an open choice prompt. |
| `duel_action` | Write | Apply one current legal AI action or submit the AI's choice. |

`action_id` values are tied to the current match revision. If the board changes, request the legal actions again. The human makes moves in the site.

ChatGPT accounts that only expose read/fetch MCP tools can inspect the board and return a selected `action_id`; paste it into **GPT가 고른 수 적용** on the site. Claude and ChatGPT hosts with MCP write-tool access can call `duel_action` directly. No AI provider credentials are stored or forwarded by the game server.
