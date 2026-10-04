package com.simsy.handbattle

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.simsy.handbattle.deck.DeckCard
import com.simsy.handbattle.deck.DeckRules
import com.simsy.handbattle.deck.PlayerDeck

private val EditorBackground = androidx.compose.ui.graphics.Color(0xFF101218)
private val EditorPanel = androidx.compose.ui.graphics.Color(0xFF1A1E28)
private val EditorCard = androidx.compose.ui.graphics.Color(0xFF242A36)
private val EditorAccent = androidx.compose.ui.graphics.Color(0xFF7DE0C3)
private val EditorMuted = androidx.compose.ui.graphics.Color(0xFF9AA3B4)
private val EditorWhite = androidx.compose.ui.graphics.Color.White

@Composable
fun DeckEditorScreen(
    cards: List<DeckCard>,
    initialDeck: PlayerDeck,
    onSave: (PlayerDeck) -> Unit,
    onCancel: () -> Unit,
    title: String = "덱 편집",
) {
    var mainCards by remember(initialDeck) { mutableStateOf(initialDeck.main) }
    var keyCards by remember(initialDeck) { mutableStateOf(initialDeck.key) }
    var selectedTab by remember { mutableStateOf(0) }
    var searchText by remember { mutableStateOf("") }
    var selectedCard by remember { mutableStateOf<DeckCard?>(null) }

    val deck = PlayerDeck(main = mainCards, key = keyCards)
    val errors = DeckRules.validate(deck, cards)
    val isKeyTab = selectedTab == 1
    val matchingCards = cards
        .filter { it.deck == (if (isKeyTab) "key" else "main") }
        .filter {
            searchText.isBlank() || it.name.contains(searchText.trim(), ignoreCase = true) ||
                it.description.contains(searchText.trim(), ignoreCase = true)
        }
    val mainCounts = mainCards.groupingBy { it }.eachCount()
    val keySet = keyCards.toSet()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(EditorBackground)
            .padding(horizontal = 24.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(title, color = EditorWhite, fontSize = 25.sp, fontWeight = FontWeight.Bold)
                Text("카드를 눌러 공식 효과 텍스트를 확인할 수 있습니다.", color = EditorMuted, fontSize = 12.sp)
            }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onCancel) { Text("취소", color = EditorMuted) }
            Button(
                onClick = { onSave(deck) },
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = EditorAccent),
            ) {
                Text("저장", color = EditorBackground, fontWeight = FontWeight.SemiBold)
            }
        }

        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(
                modifier = Modifier
                    .weight(1.2f)
                    .fillMaxSize()
                    .background(EditorPanel, RoundedCornerShape(16.dp))
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                TabRow(selectedTabIndex = selectedTab, containerColor = EditorPanel) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text("메인 카드 (${mainCards.size})", color = if (selectedTab == 0) EditorAccent else EditorMuted) },
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = { Text("키 카드 덱 (${keyCards.size}/${DeckRules.KEY_DECK_MAX})", color = if (selectedTab == 1) EditorAccent else EditorMuted) },
                    )
                }

                OutlinedTextField(
                    value = searchText,
                    onValueChange = { searchText = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("카드 검색") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = EditorWhite,
                        unfocusedTextColor = EditorWhite,
                        focusedBorderColor = EditorAccent,
                        unfocusedBorderColor = EditorMuted,
                        focusedLabelColor = EditorAccent,
                        unfocusedLabelColor = EditorMuted,
                        cursorColor = EditorAccent,
                    ),
                )

                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    items(matchingCards, key = { it.id }) { card ->
                        val count = if (card.deck == "main") mainCounts[card.id] ?: 0 else if (card.id in keySet) 1 else 0
                        DeckCardRow(
                            card = card,
                            count = count,
                            canAdd = if (card.deck == "main") count < 4 && mainCards.size < 60 else count < 1 && keyCards.size < DeckRules.KEY_DECK_MAX,
                            onDetails = { selectedCard = card },
                            onAdd = {
                                if (card.deck == "main" && count < 4 && mainCards.size < 60) mainCards = mainCards + card.id
                                if (card.deck == "key" && count == 0 && keyCards.size < DeckRules.KEY_DECK_MAX) keyCards = keyCards + card.id
                            },
                            onRemove = {
                                if (card.deck == "main" && count > 0) {
                                    val updated = mainCards.toMutableList()
                                    updated.remove(card.id)
                                    mainCards = updated
                                }
                                if (card.deck == "key" && count > 0) keyCards = keyCards - card.id
                            },
                        )
                    }
                }
            }

            Column(
                modifier = Modifier
                    .weight(0.8f)
                    .fillMaxSize()
                    .background(EditorPanel, RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Text("현재 덱", color = EditorWhite, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    text = "메인 ${mainCards.size}장 / 40~60장 · 키 카드 ${keyCards.size}/${DeckRules.KEY_DECK_MAX}장",
                    color = EditorAccent,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
                if (errors.isNotEmpty()) {
                    Text(
                        text = errors.first(),
                        color = androidx.compose.ui.graphics.Color(0xFFFFB4AB),
                        fontSize = 12.sp,
                        lineHeight = 17.sp,
                    )
                } else {
                    Text("대전에 사용할 수 있는 덱입니다.", color = EditorMuted, fontSize = 12.sp)
                }
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    item { Text("메인 덱", color = EditorMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
                    val selectedMain = cards.filter { it.deck == "main" && (mainCounts[it.id] ?: 0) > 0 }
                    items(selectedMain, key = { "main-${it.id}" }) { card ->
                        DeckSummaryRow(card, mainCounts[card.id] ?: 0)
                    }
                    item {
                        Spacer(Modifier.height(7.dp))
                        Text("키 카드 덱", color = EditorMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                    val selectedKeys = cards.filter { it.deck == "key" && it.id in keySet }
                    items(selectedKeys, key = { "key-${it.id}" }) { card ->
                        DeckSummaryRow(card, 1)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { DeckRules.starterDeck(cards).also { mainCards = it.main; keyCards = it.key } },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
                    ) {
                        Text("기본 덱 복원", color = EditorMuted, fontSize = 12.sp, maxLines = 1)
                    }
                    TextButton(onClick = onCancel) { Text("닫기", color = EditorMuted) }
                }
            }
        }
    }

    selectedCard?.let { card ->
        AlertDialog(
            onDismissRequest = { selectedCard = null },
            title = {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(card.name, color = EditorWhite, fontWeight = FontWeight.Bold)
                    Text(card.subtitle(), color = EditorMuted, fontSize = 12.sp)
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .height(360.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    Text(card.description, color = EditorWhite, fontSize = 14.sp, lineHeight = 21.sp)
                }
            },
            confirmButton = { TextButton(onClick = { selectedCard = null }) { Text("닫기", color = EditorAccent) } },
            containerColor = EditorPanel,
            titleContentColor = EditorWhite,
            textContentColor = EditorWhite,
        )
    }
}

@Composable
private fun DeckCardRow(
    card: DeckCard,
    count: Int,
    canAdd: Boolean,
    onDetails: () -> Unit,
    onAdd: () -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(EditorCard, RoundedCornerShape(11.dp))
            .clickable(onClick = onDetails)
            .padding(horizontal = 11.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(card.name, color = EditorWhite, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(card.subtitle(), color = EditorMuted, fontSize = 11.sp)
        }
        TextButton(
            onClick = onRemove,
            enabled = count > 0,
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
        ) {
            Text("−", color = if (count > 0) EditorWhite else EditorMuted, fontSize = 19.sp)
        }
        Text(count.toString(), color = EditorAccent, fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.width(18.dp))
        TextButton(
            onClick = onAdd,
            enabled = canAdd,
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
        ) {
            Text("+", color = EditorAccent, fontSize = 19.sp)
        }
    }
}

@Composable
private fun DeckSummaryRow(card: DeckCard, count: Int) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(card.name, color = EditorWhite, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text("×$count", color = EditorAccent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

private fun DeckCard.subtitle(): String {
    val typeName = when (type) {
        "monster" -> "몬스터"
        "spell" -> "마법"
        "trap" -> "함정"
        "normal" -> "일반 카드"
        "field" -> "필드 카드"
        else -> type
    }
    val zoneName = if (deck == "key") "키 카드" else "메인 덱"
    return buildString {
        append(zoneName)
        append(" · ")
        append(typeName)
        attack?.let { append(" · 공격력 "); append(it) }
    }
}
