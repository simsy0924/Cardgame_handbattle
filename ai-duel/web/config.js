const host = window.location.hostname;
const pageHost = host.endsWith(".github.io");
window.HAND_BATTLE_AI_API_BASE_URL = pageHost
  ? "https://hand-battle-ai-mcp.onrender.com"
  : window.location.origin;
