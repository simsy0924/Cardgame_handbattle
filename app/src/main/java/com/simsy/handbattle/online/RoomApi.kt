package com.simsy.handbattle.online

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import com.simsy.handbattle.deck.PlayerDeck

data class RoomPlayerSnapshot(
    val seat: Int,
    val displayName: String,
    val ready: Boolean,
    val connected: Boolean,
)

data class RoomSnapshot(
    val roomCode: String,
    val phase: String,
    val sequence: Long,
    val viewerSeat: Int,
    val players: List<RoomPlayerSnapshot?>,
    val updatedAt: Long,
    val duel: DuelSnapshot? = null,
)

data class DuelCardSnapshot(
    val uid: String?,
    val name: String?,
    val type: String?,
    val currentAttack: Int?,
    val hidden: Boolean,
)

data class DuelPlayerSnapshot(
    val seat: Int,
    val handCount: Int,
    val hand: List<DuelCardSnapshot>,
    val deckCount: Int,
    val grave: List<DuelCardSnapshot>,
    val banished: List<DuelCardSnapshot>,
    val field: List<DuelCardSnapshot>,
    val fieldZone: List<DuelCardSnapshot>,
    val keyDeckCount: Int,
    val keyDeck: List<DuelCardSnapshot>,
)

data class DuelActionSnapshot(
    val type: String,
    val uid: String?,
    val targetUid: String?,
    val effectId: String?,
    val label: String,
)

data class DuelChoiceOption(val value: String, val label: String)

data class DuelChoiceSnapshot(
    val id: String,
    val waiting: Boolean,
    val title: String,
    val kind: String,
    val inputKind: String?,
    val min: Int,
    val max: Int,
    val options: List<DuelChoiceOption>,
)

data class DuelSnapshot(
    val turnSeat: Int,
    val phase: String,
    val turnNumber: Int,
    val players: List<DuelPlayerSnapshot>,
    val actions: List<DuelActionSnapshot>,
    val pendingChoice: DuelChoiceSnapshot?,
    val winnerSeat: Int?,
    val finished: Boolean,
    val format: String,
)

data class DuelActionRequest(
    val type: String,
    val uid: String? = null,
    val targetUid: String? = null,
    val effectId: String? = null,
    val values: List<String> = emptyList(),
)

data class RoomSession(
    val roomCode: String,
    val seat: Int,
    val seatToken: String,
)

data class RoomSessionResult(
    val session: RoomSession,
    val snapshot: RoomSnapshot,
)

class RoomApiException(
    val errorCode: String,
    message: String,
) : IOException(message)

object RoomApi {
    private val webSocketClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS)
            .build()
    }

    fun createRoom(serverUrl: String, idToken: String, displayName: String): RoomSessionResult {
        val response = requestJson(
            serverUrl = serverUrl,
            path = "/v1/rooms",
            idToken = idToken,
            body = JSONObject().put("displayName", displayName),
        )
        return parseSession(response, null)
    }

    fun joinRoom(
        serverUrl: String,
        roomCode: String,
        idToken: String,
        displayName: String,
    ): RoomSessionResult {
        requireValidRoomCode(roomCode)
        val response = requestJson(
            serverUrl = serverUrl,
            path = "/v1/rooms/$roomCode/join",
            idToken = idToken,
            body = JSONObject().put("displayName", displayName),
        )
        return parseSession(response, roomCode)
    }

    fun getRoomState(serverUrl: String, idToken: String, session: RoomSession): RoomSnapshot {
        return requestJson(
            serverUrl = serverUrl,
            path = "/v1/rooms/${session.roomCode}/state",
            idToken = idToken,
            seatToken = session.seatToken,
            method = "GET",
        ).roomSnapshot()
    }

    fun setReady(
        serverUrl: String,
        idToken: String,
        session: RoomSession,
        ready: Boolean,
        deck: PlayerDeck,
    ): RoomSnapshot {
        val body = JSONObject().put("ready", ready)
        if (ready) {
            body.put("deck", JSONObject()
                .put("main", JSONArray().apply { deck.main.forEach { put(it) } })
                .put("key", JSONArray().apply { deck.key.forEach { put(it) } }))
        }
        return requestJson(
            serverUrl = serverUrl,
            path = "/v1/rooms/${session.roomCode}/ready",
            idToken = idToken,
            seatToken = session.seatToken,
            body = body,
        ).roomSnapshot()
    }

    fun submitGameAction(
        serverUrl: String,
        idToken: String,
        session: RoomSession,
        action: DuelActionRequest,
    ): RoomSnapshot {
        val body = JSONObject().put("type", action.type)
        action.uid?.let { body.put("uid", it) }
        action.targetUid?.let { body.put("targetUid", it) }
        action.effectId?.let { body.put("effectId", it) }
        if (action.type == "choice") {
            body.put("values", JSONArray().apply { action.values.forEach { put(it) } })
        }
        return requestJson(
            serverUrl = serverUrl,
            path = "/v1/rooms/${session.roomCode}/action",
            idToken = idToken,
            seatToken = session.seatToken,
            body = body,
        ).roomSnapshot()
    }

    fun reconnectRoom(serverUrl: String, idToken: String, session: RoomSession): RoomSnapshot {
        return requestJson(
            serverUrl = serverUrl,
            path = "/v1/rooms/${session.roomCode}/reconnect",
            idToken = idToken,
            seatToken = session.seatToken,
            body = JSONObject(),
        ).roomSnapshot()
    }

    fun leaveRoom(serverUrl: String, idToken: String, session: RoomSession) {
        requestJson(
            serverUrl = serverUrl,
            path = "/v1/rooms/${session.roomCode}/leave",
            idToken = idToken,
            seatToken = session.seatToken,
            body = JSONObject(),
        )
    }

    fun openRoomStream(
        serverUrl: String,
        idToken: String,
        session: RoomSession,
        onConnected: () -> Unit,
        onSnapshot: (RoomSnapshot) -> Unit,
        onDisconnected: (String) -> Unit,
    ): WebSocket {
        val request = Request.Builder()
            .url(webSocketUrl(serverUrl, "/v1/rooms/${session.roomCode}/stream"))
            .header("Authorization", "Bearer $idToken")
            .header("X-Seat-Token", session.seatToken)
            .build()

        return webSocketClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val message = JSONObject(text)
                    when (message.optString("type")) {
                        "snapshot" -> {
                            val room = message.optJSONObject("room")
                                ?: throw IOException("방 상태가 비어 있습니다.")
                            onSnapshot(parseRoomSnapshot(room))
                        }
                        "error" -> onDisconnected(messageFor(message.optString("error"), 0))
                    }
                } catch (error: Exception) {
                    onDisconnected(error.localizedMessage ?: "방 상태를 읽지 못했습니다.")
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onDisconnected(reason.ifBlank { "실시간 방 연결이 종료됐습니다." })
            }

            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                onDisconnected(error.localizedMessage ?: "실시간 방 서버에 연결하지 못했습니다.")
            }
        })
    }

    private fun requestJson(
        serverUrl: String,
        path: String,
        idToken: String,
        seatToken: String? = null,
        method: String = "POST",
        body: JSONObject? = null,
    ): JSONObject {
        val connection = URL(serverUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Authorization", "Bearer $idToken")
            connection.setRequestProperty("Accept", "application/json")
            if (seatToken != null) connection.setRequestProperty("X-Seat-Token", seatToken)
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = try {
                JSONObject(responseText)
            } catch (_: Exception) {
                throw IOException("서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도하세요.")
            }
            if (status !in 200..299) {
                val code = response.optString("error")
                throw RoomApiException(code, response.optString("message").ifBlank { messageFor(code, status) })
            }
            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun parseSession(response: JSONObject, roomCodeHint: String?): RoomSessionResult {
        val room = response.optJSONObject("room")
            ?: throw IOException("서버 응답에 방 정보가 없습니다.")
        val roomCode = response.optString("roomCode")
            .ifBlank { room.optString("code") }
            .ifBlank { roomCodeHint.orEmpty() }
        val seat = response.optInt("seat", -1)
        val seatToken = response.optString("seatToken")
        if (RoomCode.parse(roomCode) == null || seat !in 0..1 || seatToken.isBlank()) {
            throw IOException("서버 응답의 방 정보가 올바르지 않습니다.")
        }
        return RoomSessionResult(
            session = RoomSession(roomCode, seat, seatToken),
            snapshot = parseRoomSnapshot(room),
        )
    }

    private fun JSONObject.roomSnapshot(): RoomSnapshot {
        val room = optJSONObject("room") ?: throw IOException("서버 응답에 방 정보가 없습니다.")
        return parseRoomSnapshot(room)
    }

    private fun parseRoomSnapshot(room: JSONObject): RoomSnapshot {
        val playersJson: JSONArray = room.optJSONArray("players")
            ?: throw IOException("서버 응답에 참가자 정보가 없습니다.")
        if (playersJson.length() != 2) throw IOException("참가자 정보가 올바르지 않습니다.")
        val players = (0 until playersJson.length()).map { index ->
            playersJson.optJSONObject(index)?.let { player ->
                RoomPlayerSnapshot(
                    seat = player.optInt("seat", index),
                    displayName = player.optString("displayName", "Player"),
                    ready = player.optBoolean("ready", false),
                    connected = player.optBoolean("connected", false),
                )
            }
        }
        val code = room.optString("code")
        if (RoomCode.parse(code) == null) throw IOException("방 코드가 올바르지 않습니다.")
        return RoomSnapshot(
            roomCode = code,
            phase = room.optString("phase", "waiting"),
            sequence = room.optLong("sequence", 0),
            viewerSeat = room.optInt("viewerSeat", -1),
            players = players,
            updatedAt = room.optLong("updatedAt", 0),
            duel = room.optJSONObject("duel")?.let(::parseDuelSnapshot),
        )
    }

    private fun parseDuelSnapshot(duel: JSONObject): DuelSnapshot {
        val playersJson = duel.optJSONArray("players") ?: JSONArray()
        val players = (0 until playersJson.length()).mapNotNull { index ->
            playersJson.optJSONObject(index)?.let { player ->
                DuelPlayerSnapshot(
                    seat = player.optInt("seat", index),
                    handCount = player.optInt("handCount", 0),
                    hand = parseCards(player.optJSONArray("hand")),
                    deckCount = player.optInt("deckCount", 0),
                    grave = parseCards(player.optJSONArray("grave")),
                    banished = parseCards(player.optJSONArray("banished")),
                    field = parseCards(player.optJSONArray("field")),
                    fieldZone = parseCards(player.optJSONArray("fieldZone")),
                    keyDeckCount = player.optInt("keyDeckCount", 0),
                    keyDeck = parseCards(player.optJSONArray("keyDeck")),
                )
            }
        }
        val actionsJson = duel.optJSONArray("actions") ?: JSONArray()
        val actions = (0 until actionsJson.length()).mapNotNull { index ->
            actionsJson.optJSONObject(index)?.let { action ->
                DuelActionSnapshot(
                    type = action.optString("type"),
                    uid = if (action.isNull("uid")) null else action.optString("uid").takeIf { it.isNotBlank() },
                    targetUid = if (action.isNull("targetUid")) null else action.optString("targetUid").takeIf { it.isNotBlank() },
                    effectId = if (action.isNull("effectId")) null else action.optString("effectId").takeIf { it.isNotBlank() },
                    label = action.optString("label"),
                )
            }
        }
        val pending = duel.optJSONObject("pendingChoice")?.let { prompt ->
            val optionsJson = prompt.optJSONArray("options") ?: JSONArray()
            val options = (0 until optionsJson.length()).mapNotNull { index ->
                optionsJson.optJSONObject(index)?.let { option ->
                    DuelChoiceOption(option.optString("value"), option.optString("label"))
                }
            }
            DuelChoiceSnapshot(
                id = prompt.optString("id"),
                waiting = prompt.optBoolean("waiting", false),
                title = prompt.optString("title"),
                kind = prompt.optString("kind"),
                inputKind = prompt.optString("inputKind").takeIf { it.isNotBlank() },
                min = prompt.optInt("min", 1),
                max = prompt.optInt("max", 1),
                options = options,
            )
        }
        val winnerSeat = if (duel.isNull("winnerSeat")) null else duel.optInt("winnerSeat")
        return DuelSnapshot(
            turnSeat = duel.optInt("turnSeat", 0),
            phase = duel.optString("phase", "deploy"),
            turnNumber = duel.optInt("turnNumber", 1),
            players = players,
            actions = actions,
            pendingChoice = pending,
            winnerSeat = winnerSeat,
            finished = duel.optBoolean("finished", false),
            format = duel.optString("format", "스타터 덱"),
        )
    }

    private fun parseCards(cards: JSONArray?): List<DuelCardSnapshot> {
        if (cards == null) return emptyList()
        return (0 until cards.length()).mapNotNull { index ->
            cards.optJSONObject(index)?.let { card ->
                DuelCardSnapshot(
                    uid = if (card.isNull("uid")) null else card.optString("uid").takeIf { it.isNotBlank() },
                    name = if (card.isNull("name")) null else card.optString("name").takeIf { it.isNotBlank() },
                    type = if (card.isNull("type")) null else card.optString("type").takeIf { it.isNotBlank() },
                    currentAttack = if (card.isNull("currentAttack")) null else card.optInt("currentAttack"),
                    hidden = card.optBoolean("hidden", false),
                )
            }
        }
    }

    private fun webSocketUrl(serverUrl: String, path: String): String {
        val base = serverUrl.trimEnd('/')
        return when {
            base.startsWith("https://", ignoreCase = true) -> "wss://" + base.substring(8) + path
            base.startsWith("http://", ignoreCase = true) -> "ws://" + base.substring(7) + path
            else -> throw IOException("방 서버 주소가 올바르지 않습니다.")
        }
    }

    private fun requireValidRoomCode(roomCode: String) {
        if (RoomCode.parse(roomCode) == null) throw IOException("네 자리 방 코드를 입력하세요.")
    }

    private fun messageFor(error: String, status: Int): String = when (error) {
        "room_not_found" -> "방을 찾지 못했습니다. 코드를 확인하세요."
        "room_full" -> "이 방은 이미 두 명이 참가했습니다."
        "use_reconnect" -> "이미 참가한 방이 있습니다. 대기실 연결을 복구하세요."
        "invalid_seat_token" -> "이 기기의 방 연결 정보가 만료됐습니다."
        "unauthorized" -> "Firebase 인증에 실패했습니다. Google 로그인 설정을 확인하세요."
        "auth_verification_unavailable" -> "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요."
        "room_code_unavailable" -> "사용할 방 코드를 만들지 못했습니다. 다시 시도하세요."
        "game_started" -> "이미 대전이 시작됐습니다."
        "game_not_started" -> "대전이 아직 시작되지 않았습니다."
        "not_your_turn" -> "상대 턴에는 행동할 수 없습니다."
        "wrong_phase" -> "현재 단계에서는 할 수 없는 행동입니다."
        "choice_pending" -> "진행 중인 선택을 먼저 완료하세요."
        "not_prompted_player" -> "현재 선택을 요청받은 플레이어가 아닙니다."
        "game_finished" -> "대전이 끝났습니다."
        else -> if (status > 0) "방 서버 요청에 실패했습니다 ($status)." else "방 서버 연결이 종료됐습니다."
    }
}
