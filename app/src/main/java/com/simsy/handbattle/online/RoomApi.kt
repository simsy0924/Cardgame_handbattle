package com.simsy.handbattle.online

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class RoomSession(
    val roomCode: String,
    val seat: Int,
    val seatToken: String,
    val phase: String,
)

object RoomApi {
    fun createRoom(serverUrl: String, idToken: String, displayName: String): RoomSession =
        post(serverUrl, "/v1/rooms", idToken, displayName, null)

    fun joinRoom(serverUrl: String, roomCode: String, idToken: String, displayName: String): RoomSession =
        post(serverUrl, "/v1/rooms/" + roomCode + "/join", idToken, displayName, roomCode)

    private fun post(
        serverUrl: String,
        path: String,
        idToken: String,
        displayName: String,
        roomCodeHint: String?,
    ): RoomSession {
        val connection = URL(serverUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer " + idToken)
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            val body = JSONObject().put("displayName", displayName).toString().toByteArray(Charsets.UTF_8)
            connection.outputStream.use { it.write(body) }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = try {
                JSONObject(responseText)
            } catch (_: Exception) {
                throw IOException("서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도하세요.")
            }
            if (status !in 200..299) throw IOException(messageFor(response.optString("error"), status))

            val room = response.optJSONObject("room")
                ?: throw IOException("서버 응답에 방 정보가 없습니다.")
            val code = response.optString("roomCode")
                .ifBlank { room.optString("code") }
                .ifBlank { roomCodeHint.orEmpty() }
            val seat = response.optInt("seat", -1)
            val seatToken = response.optString("seatToken")
            if (code.length != RoomCode.LENGTH || seat !in 0..1 || seatToken.isBlank()) {
                throw IOException("서버 응답의 방 정보가 올바르지 않습니다.")
            }
            return RoomSession(
                roomCode = code,
                seat = seat,
                seatToken = seatToken,
                phase = room.optString("phase", "waiting"),
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun messageFor(error: String, status: Int): String = when (error) {
        "room_not_found" -> "방을 찾지 못했습니다. 코드를 확인하세요."
        "room_full" -> "이 방은 이미 두 명이 참가했습니다."
        "use_reconnect" -> "이미 참가한 계정입니다. 기존 방 연결 기능이 필요합니다."
        "unauthorized" -> "Firebase 인증에 실패했습니다. Google 로그인 설정을 확인하세요."
        "auth_verification_unavailable" -> "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요."
        "room_code_unavailable" -> "사용할 방 코드를 만들지 못했습니다. 다시 시도하세요."
        else -> "방 서버 요청에 실패했습니다 (" + status + ")."
    }
}
