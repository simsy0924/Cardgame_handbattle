package com.simsy.handbattle.ai

import android.content.Context
import com.simsy.handbattle.deck.DeckCard
import com.simsy.handbattle.deck.DeckRules
import com.simsy.handbattle.deck.PlayerDeck
import com.simsy.handbattle.online.DuelActionRequest
import com.simsy.handbattle.online.DuelSnapshot
import com.simsy.handbattle.online.RoomApi
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

data class AiDuelDeck(
    val name: String,
    val cards: PlayerDeck,
)

data class AiDuelSession(
    val gameCode: String,
    val aiName: String,
)

data class AiDuelMatch(
    val code: String,
    val aiName: String,
    val revision: Long,
    val snapshot: DuelSnapshot,
)

object AiDuelDeckParser {
    fun parse(jsonText: String, catalog: List<DeckCard>): AiDuelDeck {
        val root = try {
            JSONObject(jsonText)
        } catch (_: Exception) {
            throw IOException("AI 덱 파일이 올바른 JSON이 아닙니다.")
        }
        val deckObject = root.optJSONObject("deck") ?: root
        val mainValue = firstValue(deckObject, "main", "mainDeck", "main_deck")
            ?: throw IOException("AI 덱 JSON에 main 목록이 없습니다.")
        val keyValue = firstValue(deckObject, "key", "keyDeck", "key_deck")
            ?: throw IOException("AI 덱 JSON에 key 목록이 없습니다.")
        val deck = PlayerDeck(
            main = expandList(mainValue, "메인 덱"),
            key = expandList(keyValue, "키 카드 덱"),
        )
        val errors = DeckRules.validate(deck, catalog)
        if (errors.isNotEmpty()) throw IOException(errors.joinToString("\n"))
        val name = root.optString("name").takeIf { it.isNotBlank() } ?: "가져온 AI 덱"
        return AiDuelDeck(name = name, cards = deck)
    }

    private fun firstValue(json: JSONObject, vararg keys: String): Any? {
        for (key in keys) {
            if (json.has(key) && !json.isNull(key)) return json.opt(key)
        }
        return null
    }

    private fun expandList(value: Any, label: String): List<String> {
        val result = mutableListOf<String>()
        when (value) {
            is JSONArray -> {
                for (index in 0 until value.length()) {
                    appendEntry(result, value.opt(index), label)
                }
            }
            is JSONObject -> {
                val keys = value.keys()
                while (keys.hasNext()) {
                    val id = keys.next()
                    appendCopies(result, id, value.opt(id), label)
                }
            }
            else -> throw IOException(label + "은 카드 ID 배열 또는 매수 객체여야 합니다.")
        }
        return result
    }

    private fun appendEntry(result: MutableList<String>, entry: Any?, label: String) {
        when (entry) {
            is String -> appendCopies(result, entry, 1, label)
            is JSONObject -> {
                val id = listOf("id", "cardId", "card_id")
                    .firstNotNullOfOrNull { key ->
                        entry.optString(key).takeIf { entry.has(key) && it.isNotBlank() }
                    }
                    ?: throw IOException(label + " 항목에 카드 id가 없습니다.")
                val count = if (entry.has("count")) entry.opt("count") else 1
                appendCopies(result, id, count, label)
            }
            else -> throw IOException(label + " 항목은 카드 ID 문자열 또는 {id, count} 객체여야 합니다.")
        }
    }

    private fun appendCopies(result: MutableList<String>, id: String, countValue: Any?, label: String) {
        if (id.isBlank()) throw IOException(label + " 카드 ID가 비어 있습니다.")
        val count = when (countValue) {
            is Number -> countValue.toInt().takeIf { it.toDouble() == countValue.toDouble() }
            is String -> countValue.toIntOrNull()
            else -> null
        } ?: throw IOException(label + " 매수는 정수여야 합니다. (" + id + ")")
        if (count !in 0..60) throw IOException(label + " 매수는 0~60 사이여야 합니다. (" + id + ")")
        if (result.size + count > 61) throw IOException(label + " 목록이 너무 큽니다.")
        repeat(count) { result += id }
    }
}

object AiDuelApi {
    fun create(
        serverUrl: String,
        humanDeck: PlayerDeck,
        aiDeck: AiDuelDeck,
        aiName: String,
    ): AiDuelMatch {
        val body = JSONObject()
            .put("human_deck", deckJson(humanDeck))
            .put("ai_deck", JSONObject()
                .put("name", aiDeck.name)
                .put("main", idsJson(aiDeck.cards.main))
                .put("key", idsJson(aiDeck.cards.key)))
            .put("ai_name", aiName)
        return parseMatch(requestJson(serverUrl, "/api/games", "POST", body))
    }

    fun getState(serverUrl: String, gameCode: String): AiDuelMatch {
        requireValidCode(gameCode)
        val path = "/api/games/" + gameCode.uppercase(Locale.ROOT) + "/state"
        return parseMatch(requestJson(serverUrl, path, "GET"))
    }

    fun submitHumanAction(
        serverUrl: String,
        gameCode: String,
        action: DuelActionRequest,
    ): AiDuelMatch {
        requireValidCode(gameCode)
        val command = JSONObject().put("type", action.type)
        action.uid?.let { command.put("uid", it) }
        action.targetUid?.let { command.put("targetUid", it) }
        action.effectId?.let { command.put("effectId", it) }
        if (action.type == "choice") {
            command.put("values", idsJson(action.values))
        }
        val body = JSONObject().put("command", command)
        val path = "/api/games/" + gameCode.uppercase(Locale.ROOT) + "/action"
        return parseMatch(requestJson(serverUrl, path, "POST", body))
    }

    private fun parseMatch(response: JSONObject): AiDuelMatch {
        val code = response.optString("code").uppercase(Locale.ROOT)
        requireValidCode(code)
        val snapshot = response.optJSONObject("snapshot")
            ?: throw IOException("서버 응답에 대전 상태가 없습니다.")
        return AiDuelMatch(
            code = code,
            aiName = response.optString("aiName").takeIf { it.isNotBlank() } ?: "AI",
            revision = response.optLong("revision", 0),
            snapshot = RoomApi.parseDuelSnapshot(snapshot),
        )
    }

    private fun requestJson(
        serverUrl: String,
        path: String,
        method: String,
        body: JSONObject? = null,
    ): JSONObject {
        if (serverUrl.isBlank()) throw IOException("AI 대전 서버 주소가 설정되지 않았습니다.")
        val connection = URL(serverUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 90_000
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use {
                    it.write(body.toString().toByteArray(Charsets.UTF_8))
                }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = try {
                JSONObject(responseText)
            } catch (_: Exception) {
                throw IOException("AI 대전 서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도하세요.")
            }
            if (status !in 200..299) {
                val detail = response.optJSONObject("error")?.optString("message")
                    ?.takeIf { it.isNotBlank() }
                    ?: response.optString("message").takeIf { it.isNotBlank() }
                    ?: "AI 대전 서버 오류 (" + status + ")"
                throw IOException(detail)
            }
            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun requireValidCode(code: String) {
        if (!code.matches(Regex("[A-Fa-f0-9]{32}"))) {
            throw IOException("대전 코드가 올바르지 않습니다.")
        }
    }

    private fun deckJson(deck: PlayerDeck): JSONObject = JSONObject()
        .put("main", idsJson(deck.main))
        .put("key", idsJson(deck.key))

    private fun idsJson(ids: List<String>): JSONArray = JSONArray().apply {
        ids.forEach { put(it) }
    }
}

class AiDuelStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "hand_battle_ai_duel",
        Context.MODE_PRIVATE,
    )

    fun load(): AiDuelSession? {
        val code = preferences.getString(KEY_CODE, null)?.takeIf {
            it.matches(Regex("[A-Fa-f0-9]{32}"))
        } ?: return null
        val aiName = preferences.getString(KEY_AI_NAME, "GPT") ?: "GPT"
        return AiDuelSession(gameCode = code.uppercase(Locale.ROOT), aiName = aiName)
    }

    fun save(session: AiDuelSession) {
        preferences.edit()
            .putString(KEY_CODE, session.gameCode.uppercase(Locale.ROOT))
            .putString(KEY_AI_NAME, session.aiName)
            .apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val KEY_CODE = "game_code"
        const val KEY_AI_NAME = "ai_name"
    }
}
