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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.simsy.handbattle.deck.DeckCard
import com.simsy.handbattle.deck.DeckRules
import com.simsy.handbattle.deck.PlayerDeck

private val EditorBackground = Color(0xFF101218)
private val EditorPanel = Color(0xFF1A1E28)
private val EditorCard = Color(0xFF242A36)
private val EditorAccent = Color(0xFF7DE0C3)
private val EditorMuted = Color(0xFF9AA3B4)
private val EditorWhite = Color.White
private val EditorError = Color(0xFFFFB4AB)

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
    var editorPage by remember { mutableStateOf(0) }
    var selectedDeckTab by remember { mutableStateOf(0) }
    var searchText by remember { mutableStateOf("") }
    var selectedTheme by remember { mutableStateOf("all") }
    var selectedType by remember { mutableStateOf("all") }
    var selectedCard by remember { mutableStateOf<DeckCard?>(null) }
    var confirmRestore by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }

    val deck = PlayerDeck(main = mainCards, key = keyCards)
    val errors = DeckRules.validate(deck, cards)
    val mainCounts = mainCards.groupingBy { it }.eachCount()
    val keySet = keyCards.toSet()
    val cardsById = cards.associateBy { it.id }
    val isKeyTab = selectedDeckTab == 1
    val themeOptions = listOf("all") + cards.map { it.theme }.distinct().sorted()
    val typeOptions = listOf("all", "monster", "spell", "trap", "field", "normal")

    val matchingCards = cards
        .filter { it.deck == if (isKeyTab) "key" else "main" }
        .filter { selectedTheme == "all" || it.theme == selectedTheme }
        .filter { selectedType == "all" || it.type == selectedType }
        .filter {
            val query = searchText.trim()
            query.isEmpty() || it.name.contains(query, ignoreCase = true) ||
                it.description.contains(query, ignoreCase = true)
        }
        .sortedBy { it.name }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(EditorBackground)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, color = EditorWhite, fontSize = 23.sp, fontWeight = FontWeight.Bold)
                Text(
                    "메인 ${mainCards.size}/60장 · 키 카드 ${keyCards.size}/${DeckRules.KEY_DECK_MAX}장",
                    color = EditorAccent,
                    fontSize = 12.sp,
                )
            }
            TextButton(onClick = onCancel, contentPadding = PaddingValues(horizontal = 7.dp)) {
                Text("나가기", color = EditorMuted)
            }
            Button(
                onClick = { onSave(deck) },
                enabled = errors.isEmpty(),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = EditorAccent,
                    disabledContainerColor = EditorCard,
                ),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text("저장", color = if (errors.isEmpty()) EditorBackground else EditorMuted, fontWeight = FontWeight.SemiBold)
            }
        }

        if (errors.isNotEmpty()) {
            Text(errors.first(), color = EditorError, fontSize = 12.sp)
        }

        TabRow(selectedTabIndex = editorPage, containerColor = EditorPanel) {
            Tab(
                selected = editorPage == 0,
                onClick = { editorPage = 0 },
                text = { Text("카드 목록", color = if (editorPage == 0) EditorAccent else EditorMuted) },
            )
            Tab(
                selected = editorPage == 1,
                onClick = { editorPage = 1 },
                text = { Text("현재 덱", color = if (editorPage == 1) EditorAccent else EditorMuted) },
            )
        }

        if (editorPage == 0) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(EditorPanel, RoundedCornerShape(14.dp))
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                TabRow(selectedTabIndex = selectedDeckTab, containerColor = EditorPanel) {
                    Tab(
                        selected = selectedDeckTab == 0,
                        onClick = { selectedDeckTab = 0 },
                        text = { Text("메인 ${mainCards.size}/60", color = if (selectedDeckTab == 0) EditorAccent else EditorMuted) },
                    )
                    Tab(
                        selected = selectedDeckTab == 1,
                        onClick = { selectedDeckTab = 1 },
                        text = { Text("키 카드 ${keyCards.size}/${DeckRules.KEY_DECK_MAX}", color = if (selectedDeckTab == 1) EditorAccent else EditorMuted) },
                    )
                }

                OutlinedTextField(
                    value = searchText,
                    onValueChange = { searchText = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("카드명 또는 효과 검색") },
                    colors = searchColors(),
                )

                FilterChipRow(
                    options = themeOptions,
                    selected = selectedTheme,
                    label = ::themeLabel,
                    onSelect = { selectedTheme = it },
                )
                FilterChipRow(
                    options = typeOptions,
                    selected = selectedType,
                    label = ::typeFilterLabel,
                    onSelect = { selectedType = it },
                )

                if (matchingCards.isEmpty()) {
                    Text("검색 결과가 없습니다.", color = EditorMuted, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(matchingCards, key = { it.id }) { card ->
                            val count = if (card.deck == "main") mainCounts[card.id] ?: 0 else if (card.id in keySet) 1 else 0
                            val canAdd = if (card.deck == "main") count < 4 && mainCards.size < 60
                            else count == 0 && keyCards.size < DeckRules.KEY_DECK_MAX
                            DeckCardRow(
                                card = card,
                                count = count,
                                canAdd = canAdd,
                                onDetails = { selectedCard = card },
                                onAdd = {
                                    if (card.deck == "main" && canAdd) mainCards = mainCards + card.id
                                    if (card.deck == "key" && canAdd) keyCards = keyCards + card.id
                                },
                                onRemove = {
                                    if (card.deck == "main" && count > 0) mainCards = removeOne(mainCards, card.id)
                                    if (card.deck == "key" && count > 0) keyCards = keyCards - card.id
                                },
                            )
                        }
                    }
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(EditorPanel, RoundedCornerShape(14.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TabRow(selectedTabIndex = selectedDeckTab, containerColor = EditorPanel) {
                    Tab(
                        selected = selectedDeckTab == 0,
                        onClick = { selectedDeckTab = 0 },
                        text = { Text("메인 덱 (${mainCards.size})", color = if (selectedDeckTab == 0) EditorAccent else EditorMuted) },
                    )
                    Tab(
                        selected = selectedDeckTab == 1,
                        onClick = { selectedDeckTab = 1 },
                        text = { Text("키 카드 (${keyCards.size})", color = if (selectedDeckTab == 1) EditorAccent else EditorMuted) },
                    )
                }

                Text(
                    text = if (isKeyTab) "키 카드 덱 · 최대 ${DeckRules.KEY_DECK_MAX}장 · 같은 카드는 1장" else "메인 덱 · 40~60장 · 같은 카드는 최대 4장",
                    color = EditorMuted,
                    fontSize = 12.sp,
                )
                val selectedIds = if (isKeyTab) keyCards else mainCounts.keys.toList()
                val selectedCards = selectedIds.mapNotNull { cardsById[it] }.distinctBy { it.id }.sortedBy { it.name }
                if (selectedCards.isEmpty()) {
                    Text("아직 카드가 없습니다. 카드 목록에서 추가해 주세요.", color = EditorMuted, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(selectedCards, key = { "deck-${it.id}" }) { card ->
                            val count = if (card.deck == "main") mainCounts[card.id] ?: 0 else 1
                            val canAdd = if (card.deck == "main") count < 4 && mainCards.size < 60
                            else keyCards.size < DeckRules.KEY_DECK_MAX && card.id !in keySet
                            DeckCardRow(
                                card = card,
                                count = count,
                                canAdd = canAdd,
                                onDetails = { selectedCard = card },
                                onAdd = {
                                    if (card.deck == "main" && canAdd) mainCards = mainCards + card.id
                                    if (card.deck == "key" && canAdd) keyCards = keyCards + card.id
                                },
                                onRemove = {
                                    if (card.deck == "main" && count > 0) mainCards = removeOne(mainCards, card.id)
                                    if (card.deck == "key") keyCards = keyCards - card.id
                                },
                            )
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { confirmRestore = true },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 7.dp),
                    ) {
                        Text("기본 덱 복원", color = EditorMuted, fontSize = 12.sp, maxLines = 1)
                    }
                    OutlinedButton(
                        onClick = { confirmClear = true },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 7.dp),
                    ) {
                        Text(if (isKeyTab) "키 덱 비우기" else "메인 덱 비우기", color = EditorMuted, fontSize = 12.sp, maxLines = 1)
                    }
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
                    Text("${themeLabel(card.theme)} · ${card.subtitle()}", color = EditorMuted, fontSize = 12.sp)
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = 420.dp)
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

    if (confirmRestore) {
        AlertDialog(
            onDismissRequest = { confirmRestore = false },
            title = { Text("기본 덱을 복원할까요?", color = EditorWhite) },
            text = { Text("현재 메인 덱과 키 카드 덱 구성이 기본 덱으로 바뀝니다.", color = EditorMuted) },
            confirmButton = {
                TextButton(onClick = {
                    DeckRules.starterDeck(cards).also { mainCards = it.main; keyCards = it.key }
                    confirmRestore = false
                }) { Text("복원", color = EditorAccent) }
            },
            dismissButton = { TextButton(onClick = { confirmRestore = false }) { Text("취소", color = EditorMuted) } },
            containerColor = EditorPanel,
        )
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text(if (isKeyTab) "키 카드 덱을 비울까요?" else "메인 덱을 비울까요?", color = EditorWhite) },
            text = { Text("이 변경은 저장을 누르기 전까지 적용되지 않습니다.", color = EditorMuted) },
            confirmButton = {
                TextButton(onClick = {
                    if (isKeyTab) keyCards = emptyList() else mainCards = emptyList()
                    confirmClear = false
                }) { Text("비우기", color = EditorError) }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("취소", color = EditorMuted) } },
            containerColor = EditorPanel,
        )
    }
}

@Composable
private fun FilterChipRow(
    options: List<String>,
    selected: String,
    label: (String) -> String,
    onSelect: (String) -> Unit,
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        items(options) { value ->
            FilterChip(
                selected = selected == value,
                onClick = { onSelect(value) },
                label = { Text(label(value), fontSize = 11.sp, maxLines = 1) },
            )
        }
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
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(card.name, color = EditorWhite, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(card.subtitle(), color = EditorMuted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        TextButton(onClick = onRemove, enabled = count > 0, contentPadding = PaddingValues(horizontal = 7.dp, vertical = 0.dp)) {
            Text("−", color = if (count > 0) EditorWhite else EditorMuted, fontSize = 18.sp)
        }
        Text("$count", color = EditorAccent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        TextButton(onClick = onAdd, enabled = canAdd, contentPadding = PaddingValues(horizontal = 7.dp, vertical = 0.dp)) {
            Text("+", color = if (canAdd) EditorAccent else EditorMuted, fontSize = 18.sp)
        }
    }
}

private fun removeOne(cards: List<String>, id: String): List<String> {
    val updated = cards.toMutableList()
    updated.remove(id)
    return updated
}

@Composable
private fun searchColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = EditorWhite,
    unfocusedTextColor = EditorWhite,
    focusedBorderColor = EditorAccent,
    unfocusedBorderColor = EditorMuted,
    focusedLabelColor = EditorAccent,
    unfocusedLabelColor = EditorMuted,
    cursorColor = EditorAccent,
)

private fun themeLabel(theme: String): String = when (theme) {
    "all" -> "전체 테마"
    "generic" -> "카드 세계"
    "penguin" -> "펭귄"
    "elements" -> "엘리멘츠"
    "cthulhu" -> "크툴루"
    else -> theme
}

private fun typeFilterLabel(type: String): String = when (type) {
    "all" -> "전체 종류"
    "monster" -> "몬스터"
    "spell" -> "마법"
    "trap" -> "함정"
    "field" -> "필드"
    "normal" -> "일반 카드"
    else -> type
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
