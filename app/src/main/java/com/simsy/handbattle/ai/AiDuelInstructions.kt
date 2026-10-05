package com.simsy.handbattle.ai

/**
 * Builds the connection instructions the player pastes into the GPT or Claude conversation.
 *
 * The ChatGPT plugin publishes the Hand Battle tools under a `hand_battle_` prefix so they
 * cannot be confused with other plugins' tools, while the Claude MCP server exposes the
 * canonical names. The prompt must name the tools exactly as the connected AI sees them.
 */
object AiDuelInstructions {
    const val GPT_TOOL_PREFIX = "hand_battle_"

    fun toolPrefix(aiName: String): String = if (aiName == "GPT") GPT_TOOL_PREFIX else ""

    fun build(aiName: String, gameCode: String, mcpUrl: String): String {
        val prefix = toolPrefix(aiName)
        val connection = if (aiName == "GPT") {
            "ChatGPT에 연결된 Hand Battle AI Duel 플러그인의 " + prefix + "* 도구만 사용해."
        } else {
            "연결된 " + mcpUrl + " MCP 서버의 Hand Battle 도구를 사용해."
        }
        return listOf(
            "Hand Battle AI 대전을 진행해줘.",
            connection,
            "내 대전 코드(game_code): " + gameCode,
            "너는 AI 플레이어 B야. 먼저 " + prefix + "get_game_rules와 " + prefix + "get_card_catalog을 확인하고, " +
                prefix + "get_duel_state와 " + prefix + "get_legal_actions로 상태를 확인해.",
            "합법 행동만 " + prefix + "duel_action으로 하나씩 실행하고, 내가 앱에서 행동할 때까지 기다려.",
            "카드 효과는 카탈로그의 공식 텍스트를 따르고 내 비공개 패를 추측하지 마.",
        ).joinToString("\n")
    }
}
