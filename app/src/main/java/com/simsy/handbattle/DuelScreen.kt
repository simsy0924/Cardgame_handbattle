package com.simsy.handbattle

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
                OutlinedButton(onClick = onLeave, enabled = !isBusy) { Text("나가기") }
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
                    title = "$opponentName  ·  손패 ${opponent.handCount}장  ·  덱 ${opponent.deckCount}장",
                    cards = opponent.field,
                    fieldZone = opponent.fieldZone,
                    publicHand = opponent.hand.filterNot { it.hidden },
                    grave = opponent.grave,
                    banished = opponent.banished,
                )

                PlayerZone(
                    title = "$ownName  ·  손패 ${ownPlayer.handCount}장  ·  덱 ${ownPlayer.deckCount}장",
                    cards = ownPlayer.field,
                    fieldZone = ownPlayer.fieldZone,
                    publicHand = emptyList(),
                    grave = ownPlayer.grave,
                    banished = ownPlayer.banished,
                )

                CardStrip(title = "내 손패", cards = ownPlayer.hand)
                CardStrip(title = "내 키 카드 덱 (${ownPlayer.keyDeckCount})", cards = ownPlayer.keyDeck)
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
                    Text("${aiDuelProvider ?: "AI"} 연결", color = DuelAccent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    Text("AI 도구 연결: $aiDuelConnectionInfo", color = DuelMuted, fontSize = 10.sp)
                    Text("대전 코드: ${session.roomCode}", color = Color.White, fontSize = 11.sp)
                    Button(
                        onClick = { onCopyAiDuelInstructions?.invoke() },
                        enabled = !isBusy && onCopyAiDuelInstructions != null,
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
            Text("공격력 차이만큼 패를 버립니다. 패가 0장이 되면 패배합니다.", color = DuelMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun PlayerZone(
    title: String,
    cards: List<DuelCardSnapshot>,
    fieldZone: List<DuelCardSnapshot>,
    publicHand: List<DuelCardSnapshot>,
    grave: List<DuelCardSnapshot>,
    banished: List<DuelCardSnapshot>,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(DuelPanel, RoundedCornerShape(14.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text("몬스터 존", color = DuelMuted, fontSize = 11.sp)
        CardStrip(cards = cards, compact = true)
        if (fieldZone.isNotEmpty()) CardStrip(title = "필드 존", cards = fieldZone, compact = true)
        if (publicHand.isNotEmpty()) CardStrip(title = "공개 패", cards = publicHand, compact = true)
        Text(
            "묘지 ${grave.size}장  ·  제외 ${banished.size}장" +
                grave.takeLast(2).joinToString(prefix = if (grave.isEmpty()) "" else "  ·  ") { it.name ?: "카드" },
            color = DuelMuted,
            fontSize = 10.sp,
        )
    }
}

@Composable
private fun CardStrip(
    title: String? = null,
    cards: List<DuelCardSnapshot>,
    compact: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        if (title != null) Text(title, color = DuelMuted, fontSize = 11.sp)
        if (cards.isEmpty()) {
            Text("비어 있음", color = DuelMuted, fontSize = 11.sp)
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                cards.forEach { card -> CardTile(card = card, compact = compact) }
            }
        }
    }
}

@Composable
private fun CardTile(card: DuelCardSnapshot, compact: Boolean) {
    Card(
        modifier = Modifier.width(if (compact) 94.dp else 112.dp),
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
            if (!card.hidden && card.currentAttack != null) {
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
