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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.simsy.handbattle.online.RoomPlayerSnapshot
import com.simsy.handbattle.online.RoomSession
import com.simsy.handbattle.online.RoomSnapshot

private val LobbyBackground = Color(0xFF101218)
private val LobbyPanel = Color(0xFF1A1E28)
private val LobbyAccent = Color(0xFF7DE0C3)
private val LobbyMuted = Color(0xFF9AA3B4)

@Composable
fun RoomLobbyScreen(
    session: RoomSession,
    snapshot: RoomSnapshot?,
    connectionStatus: String,
    statusMessage: String,
    isSignedIn: Boolean,
    isBusy: Boolean,
    deckSummary: String,
    deckLegal: Boolean,
    onSignIn: () -> Unit,
    onReadyChange: (Boolean) -> Unit,
    onEditDeck: () -> Unit,
    onReconnect: () -> Unit,
    onLeave: () -> Unit,
) {
    val players = snapshot?.players ?: listOf(null, null)
    val localPlayer = players.getOrNull(session.seat)
    val opponent = players.getOrNull(1 - session.seat)
    val bothReady = snapshot?.phase == "ready" && players.all { it?.connected == true }
    val awaitingReconnect = snapshot?.phase == "ready" && !bothReady

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(LobbyBackground)
            .padding(horizontal = 36.dp, vertical = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(28.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(0.9f),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "온라인 대기실",
                color = LobbyAccent,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
            )
            Text(
                text = "방 코드",
                color = LobbyMuted,
                fontSize = 15.sp,
            )
            Text(
                text = session.roomCode,
                color = Color.White,
                fontSize = 52.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 7.sp,
            )
            Text(
                text = if (session.seat == 0) "방 생성자" else "참가자",
                color = LobbyMuted,
                fontSize = 15.sp,
            )
            Text(
                text = if (isSignedIn) connectionStatus else "Google 계정에 다시 로그인하세요.",
                color = if (connectionStatus == "실시간 연결됨") LobbyAccent else LobbyMuted,
                fontSize = 14.sp,
            )
        }

        Column(
            modifier = Modifier
                .weight(1.1f)
                .background(LobbyPanel, RoundedCornerShape(20.dp))
                .padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "플레이어",
                color = Color.White,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
            )
            PlayerSeatCard(seat = 0, player = players.getOrNull(0), isMine = session.seat == 0)
            PlayerSeatCard(seat = 1, player = players.getOrNull(1), isMine = session.seat == 1)
            Text(
                text = "내 덱: $deckSummary",
                color = if (deckLegal) LobbyAccent else Color(0xFFFFB4AB),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
            if (!deckLegal) {
                Text(
                    text = "메인 덱 40~60장, 메인 카드별 최대 4장, 키 카드 덱 최대 10장(카드별 최대 1장)이어야 합니다.",
                    color = Color(0xFFFFB4AB),
                    fontSize = 11.sp,
                )
            }

            when {
                snapshot == null -> Text(
                    text = "방 상태를 불러오는 중입니다.",
                    color = LobbyMuted,
                    fontSize = 13.sp,
                )
                bothReady -> Text(
                    text = "두 플레이어 모두 준비 완료",
                    color = LobbyAccent,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                awaitingReconnect -> Text(
                    text = "두 플레이어가 준비했습니다. 연결 복구를 기다리는 중입니다.",
                    color = LobbyMuted,
                    fontSize = 13.sp,
                )
                opponent == null -> Text(
                    text = "상대가 참가하면 준비할 수 있습니다.",
                    color = LobbyMuted,
                    fontSize = 13.sp,
                )
            }

            if (statusMessage.isNotBlank()) {
                Text(text = statusMessage, color = LobbyMuted, fontSize = 12.sp)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = onEditDeck,
                    enabled = !isBusy && localPlayer?.ready != true,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(if (localPlayer?.ready == true) "준비 취소 후 편집" else "덱 편집")
                }
                Button(
                    onClick = { onReadyChange(localPlayer?.ready != true) },
                    enabled = snapshot != null &&
                        deckLegal &&
                        localPlayer?.connected == true &&
                        opponent?.connected == true &&
                        !isBusy,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = LobbyAccent,
                        disabledContainerColor = Color(0xFF343A46),
                    ),
                ) {
                    Text(
                        text = if (localPlayer?.ready == true) "준비 취소" else "준비 완료",
                        color = Color(0xFF101218),
                        modifier = Modifier.padding(vertical = 5.dp),
                    )
                }
                OutlinedButton(
                    onClick = onReconnect,
                    enabled = isSignedIn && !isBusy && connectionStatus != "실시간 연결됨",
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text("재연결")
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!isSignedIn) {
                    Button(
                        onClick = onSignIn,
                        enabled = !isBusy,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text("Google로 로그인")
                    }
                }
                OutlinedButton(
                    onClick = onLeave,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text("나가기")
                }
            }
        }
    }
}

@Composable
private fun PlayerSeatCard(
    seat: Int,
    player: RoomPlayerSnapshot?,
    isMine: Boolean,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF242A36), RoundedCornerShape(14.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = (if (seat == 0) "방 생성자" else "참가자") + if (isMine) " · 나" else "",
            color = LobbyAccent,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = player?.displayName ?: "상대 참가 대기 중",
            color = Color.White,
            fontSize = 17.sp,
            fontWeight = FontWeight.Medium,
        )
        Text(
            text = if (player == null) "빈 자리" else {
                val connection = if (player.connected) "접속 중" else "연결 끊김"
                val readiness = if (player.ready) "준비 완료" else "미준비"
                "$connection · $readiness"
            },
            color = LobbyMuted,
            fontSize = 12.sp,
        )
    }
}
