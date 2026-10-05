package com.simsy.handbattle.deck

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class DeckCard(
    val id: String,
    val name: String,
    val type: String,
    val deck: String,
    val attack: Int?,
    val description: String,
    val theme: String = id.substringBefore('_'),
)

data class PlayerDeck(
    val main: List<String>,
    val key: List<String>,
)

object DeckCardCatalog {
    fun load(context: Context): List<DeckCard> {
        val json = context.assets.open("card_catalog.json").bufferedReader().use { it.readText() }
        val cards = JSONObject(json).optJSONArray("cards") ?: JSONArray()
        return (0 until cards.length()).mapNotNull { index ->
            cards.optJSONObject(index)?.let { card ->
                DeckCard(
                    id = card.getString("id"),
                    name = card.getString("name"),
                    type = card.getString("type"),
                    deck = card.getString("deck"),
                    attack = if (card.isNull("attack")) null else card.optInt("attack"),
                    description = card.optString("description"),
                    theme = card.optString("theme", card.getString("id").substringBefore('_')),
                )
            }
        }
    }
}

object DeckRules {
    const val KEY_DECK_MAX = 10

    fun starterDeck(cards: List<DeckCard>): PlayerDeck = PlayerDeck(
        // Keep the legacy starter deck legal as new theme pools are added.
        main = cards.filter { it.deck == "main" }.take(18).flatMap { card -> List(3) { card.id } },
        key = cards.filter { it.deck == "key" }.take(KEY_DECK_MAX).map { it.id },
    )

    fun validate(deck: PlayerDeck, cards: List<DeckCard>): List<String> {
        val definitions = cards.associateBy { it.id }
        val errors = mutableListOf<String>()
        if (deck.main.size !in 40..60) {
            errors += "메인 덱은 40~60장이어야 합니다. (현재 ${deck.main.size}장)"
        }

        deck.main.groupingBy { it }.eachCount().forEach { (id, count) ->
            val card = definitions[id]
            when {
                card == null -> errors += "메인 덱에 알 수 없는 카드가 있습니다."
                card.deck != "main" -> errors += "키 카드는 키 카드 덱에만 넣을 수 있습니다. (${card.name})"
                count > 4 -> errors += "메인 덱에는 같은 카드를 최대 4장 넣을 수 있습니다. (${card.name})"
            }
        }

        deck.key.groupingBy { it }.eachCount().forEach { (id, count) ->
            val card = definitions[id]
            when {
                card == null -> errors += "키 카드 덱에 알 수 없는 카드가 있습니다."
                card.deck != "key" -> errors += "메인 카드는 키 카드 덱에 넣을 수 없습니다. (${card.name})"
                count > 1 -> errors += "키 카드 덱에는 같은 카드를 1장만 넣을 수 있습니다. (${card.name})"
            }
        }
        if (deck.key.size > KEY_DECK_MAX) {
            errors += "키 카드 덱은 최대 ${KEY_DECK_MAX}장까지 넣을 수 있습니다. (현재 ${deck.key.size}장)"
        }
        return errors.distinct()
    }
}

class DeckStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "hand_battle_deck",
        Context.MODE_PRIVATE,
    )

    fun load(cards: List<DeckCard>): PlayerDeck {
        val main = preferences.getString(KEY_MAIN, null)
        val key = preferences.getString(KEY_KEY, null)
        if (main == null && key == null) return DeckRules.starterDeck(cards)

        return try {
            PlayerDeck(
                main = parseIds(main ?: "[]"),
                key = parseIds(key ?: "[]"),
            )
        } catch (_: Exception) {
            DeckRules.starterDeck(cards)
        }
    }

    fun save(deck: PlayerDeck) {
        preferences.edit()
            .putString(KEY_MAIN, JSONArray(deck.main).toString())
            .putString(KEY_KEY, JSONArray(deck.key).toString())
            .apply()
    }

    private fun parseIds(value: String): List<String> {
        val array = JSONArray(value)
        return (0 until array.length()).map { index -> array.getString(index) }
    }

    private companion object {
        const val KEY_MAIN = "main_cards"
        const val KEY_KEY = "key_cards"
    }
}
