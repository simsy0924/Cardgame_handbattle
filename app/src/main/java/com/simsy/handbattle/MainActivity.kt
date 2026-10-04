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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Background = Color(0xFF101218)
private val Panel = Color(0xFF1A1E28)
private val Accent = Color(0xFF7DE0C3)
private val Muted = Color(0xFF9AA3B4)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Background) {
                    FreshStartScreen()
                }
            }
        }
    }
}

@Composable
private fun FreshStartScreen() {
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
                text = "처음부터 다시 시작합니다",
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "모바일 로컬 2인 대전을 기준으로 새 앱 기반을 만들고 있어요.",
                color = Muted,
                fontSize = 16.sp,
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .background(Panel, RoundedCornerShape(20.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("기본 규칙", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            RuleLine("승리 조건", "상대의 패를 0장으로 만들기")
            RuleLine("본덱", "40–60장 · 카드별 최대 4장")
            RuleLine("첫 패", "선공 6장 · 후공 7장")
            RuleLine("화면", "가로 방향 · 로컬 2인")
            Spacer(Modifier.height(4.dp))
            Button(
                onClick = {},
                enabled = false,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(disabledContainerColor = Color(0xFF343A46)),
            ) {
                Text(
                    "대전 화면을 만드는 중",
                    color = Color(0xFFCFD4DE),
                    modifier = Modifier.padding(vertical = 5.dp),
                )
            }
        }
    }
}

@Composable
private fun RuleLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Muted, fontSize = 14.sp, modifier = Modifier.width(88.dp))
        Text(value, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}
