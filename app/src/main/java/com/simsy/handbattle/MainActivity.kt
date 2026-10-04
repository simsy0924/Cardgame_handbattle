package com.simsy.handbattle

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.simsy.handbattle.online.RoomCode

private val Background = Color(0xFF101218)
private val Panel = Color(0xFF1A1E28)
private val Accent = Color(0xFF7DE0C3)
private val Muted = Color(0xFF9AA3B4)
private const val ONLINE_BACKEND_READY = false

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Background) {
                    OnlineStartScreen()
                }
            }
        }
    }
}

@Composable
private fun OnlineStartScreen() {
    var roomCodeInput by remember { mutableStateOf("") }
    val roomCodeIsValid = RoomCode.parse(roomCodeInput) != null

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .padding(horizontal = 36.dp, vertical = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(28.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "HAND BATTLE",
                color = Accent,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                text = "친구와 온라인 대전",
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "방을 만들고 네 자리 초대 코드로 상대를 불러오세요.",
                color = Muted,
                fontSize = 16.sp,
            )
            Spacer(Modifier.height(24.dp))
            Text(
                text = "서버가 게임 진행을 판정하고, 앱은 방 상태를 실시간으로 보여줍니다.",
                color = Muted,
                fontSize = 14.sp,
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .background(Panel, RoundedCornerShape(20.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("온라인 대전", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Text("초대 코드로 방에 참가", color = Muted, fontSize = 14.sp)
            OutlinedTextField(
                value = roomCodeInput,
                onValueChange = { entered ->
                    roomCodeInput = entered.filter { it in '0'..'9' }.take(RoomCode.LENGTH)
                },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("네 자리 방 코드") },
                placeholder = { Text("예: 0427") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Muted,
                    focusedLabelColor = Accent,
                    unfocusedLabelColor = Muted,
                    cursorColor = Accent,
                ),
            )
            Button(
                onClick = {},
                enabled = roomCodeIsValid && ONLINE_BACKEND_READY,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
            ) {
                Text("방 참가", color = Color(0xFFCFD4DE), modifier = Modifier.padding(vertical = 5.dp))
            }
            Button(
                onClick = {},
                enabled = ONLINE_BACKEND_READY,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
            ) {
                Text("새 방 만들기", color = Color(0xFFCFD4DE), modifier = Modifier.padding(vertical = 5.dp))
            }
            Spacer(Modifier.height(2.dp))
            Text(
                text = "온라인 로그인과 방 서버를 연결하는 중입니다.",
                color = Muted,
                fontSize = 12.sp,
            )
        }
    }
}
