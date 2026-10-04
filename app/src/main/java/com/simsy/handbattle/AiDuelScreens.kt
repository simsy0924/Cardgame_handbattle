package com.simsy.handbattle

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.simsy.handbattle.ai.AiDuelDeck
import com.simsy.handbattle.ai.AiDuelMatch
import com.simsy.handbattle.ai.AiDuelSession
import com.simsy.handbattle.deck.DeckCard
import com.simsy.handbattle.deck.DeckRules
import com.simsy.handbattle.deck.PlayerDeck
import com.simsy.handbattle.online.DuelActionRequest
import com.simsy.handbattle.online.RoomPlayerSnapshot
import com.simsy.handbattle.online.RoomSession
import com.simsy.handbattle.online.RoomSnapshot
import kotlinx.coroutines.delay

private val AiSetupBackground = Color(0xFF101218)
private val AiSetupPanel = Color(0xFF1A1E28)
private val AiSetupAccent = Color(0xFF7DE0C3)
private val AiSetupMuted = Color(0xFF9AA3B4)

@Composable
fun AiDuelSetupScreen(
    cards: List<DeckCard>,
    humanDeck: PlayerDeck,
    aiDeck: AiDuelDeck?,
    isBusy: Boolean,
    statusMessage: String,
    onBack: () -> Unit,
    onEditAiDeck: () -> Unit,
    onStart: (AiDuelDeck, String) -> Unit,
) {
    var selectedAiName by remember { mutableStateOf("GPT") }
    val humanDeckErrors = remember(humanDeck, cards) { DeckRules.validate(humanDeck, cards) }
    val aiDeckErrors = remember(aiDeck, cards) {
        aiDeck?.let { DeckRules.validate(it.cards, cards) } ?: emptyList()
    }

    Row(
        modifier = Modifier.fillMaxSize().background(AiSetupBackground).padding(28.dp),
        horizontalArrangement = Arrangement.spacedBy(26.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("HAND BATTLE", color = AiSetupAccent, fontSize = 15.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)
            Text("AI 대전", color = Color.White, fontSize = 31.sp, fontWeight = FontWeight.Bold)
            Text("앱의 덱 편집창에서 AI 덱을 만들고 대전을 시작하세요. 게임은 이 앱 화면에서 진행됩니다.", color = AiSetupMuted, fontSize = 15.sp)
            Text("연결된 GPT 또는 Claude 대화에 안내를 붙여넣고 Hand Battle 도구로 플레이하세요.", color = AiSetupMuted, fontSize = 13.sp)
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onBack) { Text("나가기") }
        }

        Column(
            modifier = Modifier.weight(1f).background(AiSetupPanel, RoundedCornerShape(20.dp))
                .verticalScroll(rememberScrollState()).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Text("대전 설정", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Text("내 덱  ·  메인 " + humanDeck.main.size + "장 / 키 카드 " + humanDeck.key.size + "장", color = AiSetupAccent, fontSize = 13.sp)
            humanDeckErrors.firstOrNull()?.let { error ->
                Text("내 덱을 먼저 수정해야 합니다: " + error, color = Color(0xFFFFB4AB), fontSize = 12.sp)
            }
            Text("상대 모델", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("GPT", "Claude").forEach { name ->
                    Button(
                        onClick = { selectedAiName = name },
                        enabled = !isBusy,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (selectedAiName == name) AiSetupAccent else Color(0xFF303745),
                            disabledContainerColor = Color(0xFF343A46),
                        ),
                    ) {
                        Text(name, color = if (selectedAiName == name) Color(0xFF101218) else Color.White)
                    }
                }
            }
            OutlinedButton(
                onClick = onEditAiDeck,
                enabled = !isBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (aiDeck == null) "AI 덱 만들기" else "AI 덱 편집")
            }
            aiDeck?.let { deck ->
                Text(deck.name, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text("메인 " + deck.cards.main.size + "장 · 키 카드 " + deck.cards.key.size + "장", color = AiSetupAccent, fontSize = 12.sp)
                aiDeckErrors.firstOrNull()?.let { error ->
                    Text("AI 덱을 수정해야 합니다: " + error, color = Color(0xFFFFB4AB), fontSize = 12.sp)
                }
            } ?: Text("AI 덱 편집창에서 카드와 매수를 정하세요. 메인 40~60장, 같은 카드 최대 4장, 키 카드 최대 10장까지 넣을 수 있습니다.", color = AiSetupMuted, fontSize = 12.sp, lineHeight = 17.sp)
            if (statusMessage.isNotBlank()) Text(statusMessage, color = if (isBusy) AiSetupMuted else Color(0xFFFFB4AB), fontSize = 12.sp, lineHeight = 17.sp)
            Button(
                onClick = { aiDeck?.let { onStart(it, selectedAiName) } },
                enabled = aiDeck != null && aiDeckErrors.isEmpty() && humanDeckErrors.isEmpty() && !isBusy,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = AiSetupAccent, disabledContainerColor = Color(0xFF343A46)),
            ) {
                Text(if (isBusy) "대전 생성 중…" else "대전 시작", color = if (isBusy) Color.White else Color(0xFF101218), modifier = Modifier.padding(vertical = 4.dp))
            }
        }
    }
}

@Composable
fun AiDuelScreen(
    session: AiDuelSession,
    cards: List<DeckCard>,
    match: AiDuelMatch?,
    connectionStatus: String,
    statusMessage: String,
    isBusy: Boolean,
    onAction: (DuelActionRequest) -> Unit,
    onRefresh: () -> Unit,
    onLeave: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val mcpUrl = BuildConfig.AI_DUEL_SERVER_URL.trimEnd('/') + "/mcp"
    val connectionInfo = if (session.aiName == "GPT") {
        "ChatGPT에 연결된 Hand Battle AI Duel MCP 도구"
    } else {
        "Claude MCP 서버: " + mcpUrl
    }
    val prompt = remember(session.gameCode, session.aiName, mcpUrl) {
        listOf(
            "Hand Battle AI 대전을 진행해줘.",
            "연결된 AI 도구로 대전해. Claude라면 " + mcpUrl + " MCP 서버를 사용해.",
            "내 대전 코드: " + session.gameCode,
            "너는 AI 플레이어 B야. 먼저 get_game_rules와 get_card_catalog을 확인하고, get_duel_state와 get_legal_actions로 상태를 확인해.",
            "합법 행동만 duel_action으로 하나씩 실행하고, 내가 앱에서 행동할 때까지 기다려.",
            "카드 효과는 카탈로그의 공식 텍스트를 따르고 내 비공개 패를 추측하지 마.",
        ).joinToString("\n")
    }
    LaunchedEffect(session.gameCode) {
        onRefresh()
        while (true) {
            delay(3_500)
            onRefresh()
        }
    }

    val snapshot = RoomSnapshot(
        roomCode = session.gameCode,
        phase = if (match?.snapshot?.finished == true) "finished" else "playing",
        sequence = match?.revision ?: 0L,
        viewerSeat = 0,
        players = listOf(
            RoomPlayerSnapshot(seat = 0, displayName = "나", ready = true, connected = true),
            RoomPlayerSnapshot(seat = 1, displayName = session.aiName, ready = true, connected = true),
        ),
        updatedAt = System.currentTimeMillis(),
        duel = match?.snapshot,
    )
    DuelScreen(
        session = RoomSession(roomCode = session.gameCode, seat = 0, seatToken = ""),
        snapshot = snapshot,
        connectionStatus = connectionStatus,
        statusMessage = statusMessage,
        isBusy = isBusy,
        onAction = onAction,
        onLeave = onLeave,
        aiDuelProvider = session.aiName,
        aiDuelConnectionInfo = connectionInfo,
        cards = cards,
        aiToolSeen = match?.aiToolSeen,
        onCopyAiDuelInstructions = { clipboard.setText(AnnotatedString(prompt)) },
        onRefresh = onRefresh,
    )
}

