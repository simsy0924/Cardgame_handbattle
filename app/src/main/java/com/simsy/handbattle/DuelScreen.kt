package com.simsy.handbattle

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.simsy.handbattle.deck.DeckCard
import com.simsy.handbattle.online.DuelActionRequest
import com.simsy.handbattle.online.DuelActionSnapshot
import com.simsy.handbattle.online.DuelCardSnapshot
import com.simsy.handbattle.online.DuelPlayerSnapshot
import com.simsy.handbattle.online.DuelSnapshot
import com.simsy.handbattle.online.RoomSession
import com.simsy.handbattle.online.RoomSnapshot

private val DuelBackground = Color(0xFF101218)
private val DuelPanel = Color(0xFF1A1E28)
private val DuelAccent = Color(0xFF7DE0C3)
private val DuelMuted = Color(0xFF9AA3B4)

@Composable
fun DuelScreen(
    session: RoomSession,
    snapshot: RoomSnapshot,
    connectionStatus: String,
    statusMessage: String,
    isBusy: Boolean,
    onAction: (DuelActionRequest) -> Unit,
    onLeave: () -> Unit,
    aiDuelProvider: String? = null,
    aiDuelConnectionInfo: String? = null,
    aiToolSeen: Boolean? = null,
    cards: List<DeckCard> = emptyList(),
    onCopyAiDuelInstructions: (() -> Unit)? = null,
    onRefresh: (() -> Unit)? = null,
) {
    val game = snapshot.duel
    val ownSeat = session.seat
    val ownPlayer = game?.players?.firstOrNull { it.seat == ownSeat }
    val opponent = game?.players?.firstOrNull { it.seat != ownSeat }
    val ownName = snapshot.players.getOrNull(ownSeat)?.displayName ?: "나"
    val opponentName = snapshot.players.getOrNull(1 - ownSeat)?.displayName ?: "상대"
    val choice = game?.pendingChoice
    var selectedValues by remember(choice?.id) { mutableStateOf(emptySet<String>()) }
    var selectedCard by remember { mutableStateOf<DuelCardSnapshot?>(null) }

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(DuelBackground)
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(
            modifier = Modifier.weight(1.65f).fillMaxHeight().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = "대전  ·  ${session.roomCode}",
                    color = DuelAccent,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
                Text(connectionStatus, color = DuelMuted, fontSize = 12.sp)
                Spacer(Modifier.weight(1f))
                if (onRefresh != null) {
                    OutlinedButton(onClick = onRefresh, enabled = !isBusy) { Text("새로고침") }
                }
                OutlinedButton(onClick = onLeave) { Text("나가기") }
            }

            if (game == null || ownPlayer == null || opponent == null) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = DuelPanel,
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Text(
                        "대전 상태를 불러오는 중입니다.",
                        color = Color.White,
                        modifier = Modifier.padding(24.dp),
                    )
                }
            } else {
                if (game.finished) {
                    val result = when (game.winnerSeat) {
                        -1 -> "무승부"
                        ownSeat -> "승리했습니다"
                        else -> "대전에서 패배했습니다"
                    }
                    Text(result, color = DuelAccent, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                } else {
                    val activeName = snapshot.players.getOrNull(game.turnSeat)?.displayName ?: "플레이어"
                    Text(
                        "${game.turnNumber}턴  ·  ${phaseName(game.phase)}  ·  ${activeName}의 턴",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }

                PlayerZone(
                    title = opponentName,
                    handCount = opponent.handCount,
                    deckCount = opponent.deckCount,
                    keyDeckCount = opponent.keyDeckCount,
                    cards = opponent.field,
                    fieldZone = opponent.fieldZone,
                    publicHand = opponent.hand.filterNot { it.hidden },
                    grave = opponent.grave,
                    banished = opponent.banished,
                    onCardClick = { selectedCard = it },
                )

                PlayerZone(
                    title = ownName,
                    handCount = ownPlayer.handCount,
                    deckCount = ownPlayer.deckCount,
                    keyDeckCount = ownPlayer.keyDeckCount,
                    cards = ownPlayer.field,
                    fieldZone = ownPlayer.fieldZone,
                    publicHand = ownPlayer.hand.filter { it.revealed && !it.hidden },
                    grave = ownPlayer.grave,
                    banished = ownPlayer.banished,
                    onCardClick = { selectedCard = it },
                )

                CardStrip(
                    title = "내 손패 (${ownPlayer.handCount})",
                    cards = ownPlayer.hand,
                    showVisibility = true,
                    onCardClick = { selectedCard = it },
                )
                CardStrip(
                    title = "내 키 카드 덱 (${ownPlayer.keyDeckCount})",
                    cards = ownPlayer.keyDeck,
                    onCardClick = { selectedCard = it },
                )
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .background(DuelPanel, RoundedCornerShape(16.dp))
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("게임 행동", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(game?.format ?: "스타터 덱", color = DuelMuted, fontSize = 12.sp)
            if (aiDuelConnectionInfo != null) {
                Column(
                    modifier = Modifier.fillMaxWidth()
                        .background(Color(0xFF252C3A), RoundedCornerShape(10.dp))
                        .padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text("${aiDuelProvider ?: "AI"} 대전 연결 상태", color = DuelAccent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    Text("게임 서버: $connectionStatus", color = DuelMuted, fontSize = 11.sp)
                    Text(
                        "AI 도구 호출: " + if (aiToolSeen == true) "확인됨" else "대기 중",
                        color = if (aiToolSeen == true) DuelAccent else DuelMuted,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        if (aiToolSeen == true) "AI 대화의 도구 호출이 게임 서버에 도달했습니다."
                        else "연결한 GPT 또는 Claude 대화에서 안내를 붙여넣고 대전 상태를 조회하세요.",
                        color = DuelMuted,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                    )
                    Text("도구 설정: $aiDuelConnectionInfo", color = DuelMuted, fontSize = 10.sp)
                    Text("대전 코드: ${session.roomCode}", color = Color.White, fontSize = 11.sp)
                    Button(
                        onClick = { onCopyAiDuelInstructions?.invoke() },
                        enabled = onCopyAiDuelInstructions != null,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(9.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DuelAccent),
                    ) {
                        Text("AI 연결 안내 복사", color = Color(0xFF101218))
                    }
                }
            }
            if (game == null) {
                Text("대전 상태를 불러오는 중입니다.", color = DuelMuted, fontSize = 13.sp)
            } else if (game.finished) {
                Text("패가 0장이 되면 패배합니다.", color = DuelMuted, fontSize = 13.sp)
            } else if (choice != null) {
                ChoicePanel(
                    prompt = choice,
                    selectedValues = selectedValues,
                    enabled = !isBusy,
                    onToggle = { value ->
                        selectedValues = if (value in selectedValues) {
                            selectedValues - value
                        } else if (selectedValues.size < choice.max) {
                            selectedValues + value
                        } else {
                            selectedValues
                        }
                    },
                    onSubmit = { values -> onAction(DuelActionRequest(type = "choice", values = values)) },
                )
            } else {
                if (game.turnSeat != ownSeat) {
                    Text("상대의 행동을 기다리는 중입니다.", color = DuelMuted, fontSize = 13.sp)
                }
                if (game.actions.isEmpty()) {
                    Text("지금 할 수 있는 행동이 없습니다.", color = DuelMuted, fontSize = 13.sp)
                } else {
                    game.actions.forEach { action ->
                        Button(
                            onClick = { onAction(action.toRequest()) },
                            enabled = !isBusy,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (action.type == "next_phase") DuelAccent else Color(0xFF303745),
                                disabledContainerColor = Color(0xFF343A46),
                            ),
                        ) {
                            Text(
                                text = action.label,
                                color = if (action.type == "next_phase") Color(0xFF101218) else Color.White,
                                modifier = Modifier.padding(vertical = 2.dp),
                            )
                        }
                    }
                }
            }

            if (statusMessage.isNotBlank()) {
                Text(statusMessage, color = Color(0xFFFFB4AB), fontSize = 12.sp, lineHeight = 16.sp)
            }
            Spacer(Modifier.height(4.dp))
            Text("일반 소환은 없습니다. 몬스터는 카드 효과나 키 소환 절차로 소환합니다. 패가 0장이 되면 패배합니다.", color = DuelMuted, fontSize = 12.sp, lineHeight = 16.sp)
        }
    }

    selectedCard?.takeIf { !it.hidden }?.let { card ->
        val catalogCard = cards.firstOrNull { it.id == card.cardId }
        AlertDialog(
            onDismissRequest = { selectedCard = null },
            title = {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(card.name ?: catalogCard?.name ?: "카드", color = Color.White, fontWeight = FontWeight.Bold)
                    Text(
                        listOfNotNull(card.type, card.currentAttack?.let { "공격력 $it" }).joinToString(" · "),
                        color = DuelMuted,
                        fontSize = 12.sp,
                    )
                }
            },
            text = {
                Column(
                    modifier = Modifier.height(360.dp).verticalScroll(rememberScrollState()),
                ) {
                    Text(
                        catalogCard?.description ?: card.description ?: "효과 정보가 없습니다.",
                        color = Color.White,
                        fontSize = 14.sp,
                        lineHeight = 21.sp,
                    )
                }
            },
            confirmButton = { TextButton(onClick = { selectedCard = null }) { Text("닫기", color = DuelAccent) } },
            containerColor = DuelPanel,
            titleContentColor = Color.White,
            textContentColor = Color.White,
        )
    }
}

@Composable
private fun PlayerZone(
    title: String,
    handCount: Int,
    deckCount: Int,
    keyDeckCount: Int,
    cards: List<DuelCardSnapshot>,
    fieldZone: List<DuelCardSnapshot>,
    publicHand: List<DuelCardSnapshot>,
    grave: List<DuelCardSnapshot>,
    banished: List<DuelCardSnapshot>,
    onCardClick: (DuelCardSnapshot) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(DuelPanel, RoundedCornerShape(14.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(title, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            ZoneCount("손패", handCount, Modifier.weight(1f))
            ZoneCount("메인 덱", deckCount, Modifier.weight(1f))
            ZoneCount("키 카드 덱", keyDeckCount, Modifier.weight(1f))
            ZoneCount("묘지 / 제외", grave.size + banished.size, Modifier.weight(1f))
        }
        Text("몬스터 존 (${cards.size}/5)", color = DuelMuted, fontSize = 11.sp)
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            repeat(5) { index ->
                val card = cards.getOrNull(index)
                Box(
                    modifier = Modifier
                        .width(100.dp)
                        .height(108.dp)
                        .background(Color(0xFF171B23), RoundedCornerShape(9.dp))
                        .border(1.dp, Color(0xFF343A46), RoundedCornerShape(9.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (card == null) {
                        Text("빈 칸\n${index + 1}", color = DuelMuted, fontSize = 10.sp)
                    } else {
                        CardTile(card = card, compact = true, onClick = { onCardClick(card) })
                    }
                }
            }
        }
        CardStrip(
            title = "필드 존",
            cards = fieldZone,
            compact = true,
            emptyLabel = "비어 있음",
            onCardClick = onCardClick,
        )
        if (publicHand.isNotEmpty()) {
            CardStrip(
                title = "공개 패 (${publicHand.size})",
                cards = publicHand,
                compact = true,
                showVisibility = true,
                onCardClick = onCardClick,
            )
        }
        CardStrip(title = "묘지 (${grave.size})", cards = grave, compact = true, onCardClick = onCardClick)
        CardStrip(title = "제외 (${banished.size})", cards = banished, compact = true, onCardClick = onCardClick)
    }
}

@Composable
private fun ZoneCount(label: String, count: Int, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.background(Color(0xFF252C3A), RoundedCornerShape(8.dp)).padding(horizontal = 7.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, color = DuelMuted, fontSize = 9.sp, maxLines = 1)
        Text(count.toString(), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun CardStrip(
    title: String? = null,
    cards: List<DuelCardSnapshot>,
    compact: Boolean = false,
    showVisibility: Boolean = false,
    emptyLabel: String = "비어 있음",
    onCardClick: (DuelCardSnapshot) -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        if (title != null) Text(title, color = DuelMuted, fontSize = 11.sp)
        if (cards.isEmpty()) {
            Text(emptyLabel, color = DuelMuted, fontSize = 11.sp)
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                cards.forEach { card ->
                    CardTile(
                        card = card,
                        compact = compact,
                        showVisibility = showVisibility,
                        onClick = { onCardClick(card) },
                    )
                }
            }
        }
    }
}

@Composable
private fun CardTile(
    card: DuelCardSnapshot,
    compact: Boolean,
    showVisibility: Boolean = false,
    onClick: () -> Unit = {},
) {
    Card(
        modifier = Modifier
            .width(if (compact) 94.dp else 112.dp)
            .clickable(enabled = !card.hidden, onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = if (card.hidden) Color(0xFF252B36) else Color(0xFF252C3A)),
    ) {
        Column(
            modifier = Modifier.padding(9.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = if (card.hidden) "비공개" else card.name ?: "카드",
                color = Color.White,
                fontSize = if (compact) 10.sp else 11.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                minLines = 2,
            )
            if (showVisibility) {
                Text(
                    if (card.revealed) "공개 상태" else "비공개 상태",
                    color = if (card.revealed) DuelAccent else DuelMuted,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            } else if (!card.hidden && card.currentAttack != null) {
                Text("공격력 ${card.currentAttack}", color = DuelAccent, fontSize = 10.sp)
            } else if (!card.hidden && card.type != null) {
                Text(card.type, color = DuelMuted, fontSize = 9.sp)
            } else {
                Text("", fontSize = 9.sp)
            }
        }
    }
}

@Composable
private fun ChoicePanel(
    prompt: com.simsy.handbattle.online.DuelChoiceSnapshot,
    selectedValues: Set<String>,
    enabled: Boolean,
    onToggle: (String) -> Unit,
    onSubmit: (List<String>) -> Unit,
) {
    Text(prompt.title, color = DuelAccent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    if (prompt.waiting) {
        Text("선택이 끝나면 게임이 이어집니다.", color = DuelMuted, fontSize = 12.sp)
        return
    }

    val multiple = prompt.kind == "choose" && prompt.inputKind != "number"
    prompt.options.forEach { option ->
        val chosen = option.value in selectedValues
        OutlinedButton(
            onClick = {
                if (multiple) onToggle(option.value) else onSubmit(listOf(option.value))
            },
            enabled = enabled && (!multiple || chosen || selectedValues.size < prompt.max),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(10.dp),
        ) {
            Text(
                text = if (chosen) "✓  ${option.label}" else option.label,
                color = if (chosen) DuelAccent else Color.White,
            )
        }
    }
    if (multiple) {
        Button(
            onClick = { onSubmit(selectedValues.toList()) },
            enabled = enabled && selectedValues.size in prompt.min..prompt.max,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = DuelAccent),
        ) {
            Text("선택 완료 (${selectedValues.size})", color = Color(0xFF101218))
        }
    }
}

private fun DuelActionSnapshot.toRequest(): DuelActionRequest = DuelActionRequest(
    type = type,
    uid = uid,
    targetUid = targetUid,
    effectId = effectId,
)

private fun phaseName(phase: String): String = when (phase) {
    "deploy" -> "전개 단계"
    "attack" -> "공격 단계"
    "end" -> "엔드 단계"
    else -> phase
}
