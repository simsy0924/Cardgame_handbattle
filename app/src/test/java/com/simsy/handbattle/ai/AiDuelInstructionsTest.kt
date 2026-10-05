package com.simsy.handbattle.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiDuelInstructionsTest {
    private val code = "0123456789ABCDEF0123456789ABCDEF"
    private val mcpUrl = "https://hand-battle-ai-mcp.onrender.com/mcp"

    @Test
    fun gptInstructionsUseTheNamespacedPluginToolNames() {
        val prompt = AiDuelInstructions.build(aiName = "GPT", gameCode = code, mcpUrl = mcpUrl)
        for (tool in listOf("get_game_rules", "get_card_catalog", "get_duel_state", "get_legal_actions", "duel_action")) {
            assertTrue(tool, prompt.contains("hand_battle_$tool"))
            assertFalse(tool, Regex("(?<![_a-z])$tool").containsMatchIn(prompt))
        }
        assertTrue(prompt.contains(code))
        assertFalse(prompt.contains(mcpUrl))
    }

    @Test
    fun claudeInstructionsUseTheCanonicalServerToolNames() {
        val prompt = AiDuelInstructions.build(aiName = "Claude", gameCode = code, mcpUrl = mcpUrl)
        assertFalse(prompt.contains("hand_battle_"))
        assertTrue(prompt.contains("get_legal_actions"))
        assertTrue(prompt.contains("duel_action"))
        assertTrue(prompt.contains(mcpUrl))
        assertTrue(prompt.contains(code))
        assertEquals("", AiDuelInstructions.toolPrefix("Claude"))
    }
}
