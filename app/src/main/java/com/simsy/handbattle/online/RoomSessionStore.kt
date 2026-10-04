package com.simsy.handbattle.online

import android.content.Context

/** Stores only the caller's private room capability in app-private preferences. */
class RoomSessionStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun load(): RoomSession? {
        val roomCode = preferences.getString(KEY_ROOM_CODE, null) ?: return null
        val seat = preferences.getInt(KEY_SEAT, -1)
        val seatToken = preferences.getString(KEY_SEAT_TOKEN, null).orEmpty()
        if (RoomCode.parse(roomCode) == null || seat !in 0..1 || seatToken.isBlank()) {
            clear()
            return null
        }
        return RoomSession(roomCode, seat, seatToken)
    }

    fun save(session: RoomSession) {
        preferences.edit()
            .putString(KEY_ROOM_CODE, session.roomCode)
            .putInt(KEY_SEAT, session.seat)
            .putString(KEY_SEAT_TOKEN, session.seatToken)
            .apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "hand_battle_room_session"
        const val KEY_ROOM_CODE = "room_code"
        const val KEY_SEAT = "seat"
        const val KEY_SEAT_TOKEN = "seat_token"
    }
}
